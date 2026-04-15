# CodePipeline Learning Demo 🚀

A fully self-contained AWS CodePipeline example that takes a **TypeScript Node.js Lambda**
from GitHub push → build → test → production deployment using **CDK** for infrastructure and
**CloudFormation** for pipeline orchestration.

---

## Architecture

```
GitHub Push
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  AWS CodePipeline                                                               │
│                                                                                 │
│  ┌──────────┐   ┌────────────────┐   ┌────────────────┐   ┌──────────────────┐ │
│  │  Source  │──▶│     Build      │──▶│      Test      │──▶│     Deploy       │ │
│  │  GitHub  │   │ tsc + cdk synth│   │ CDK assertions │   │                  │ │
│  │  (push)  │   │                │   │ + temp stack   │   │ ┌─ PreDeploy ──┐ │ │
│  └──────────┘   └────────────────┘   │ integration    │   │ │ CFN deploy  │ │ │
│                                       │ test           │   │ │ + appspec   │ │ │
│                                       └────────────────┘   │ └─────────────┘ │ │
│                                                            │ ┌─ CodeDeploy ┐ │ │
│                                                            │ │ AllAtOnce   │ │ │
│                                                            │ │ Before hook │ │ │
│                                                            │ │ After hook  │ │ │
│                                                            │ └─────────────┘ │ │
│                                                            └──────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
API Gateway → Lambda Alias "live" → Lambda Version N
```

---

## Repository Structure

```
codepipeline-learn/
│
├── app/                            # TypeScript Lambda application
│   ├── src/index.ts                # Lambda handler → JSON response
│   ├── package.json                # devDeps: typescript, @types/aws-lambda
│   └── tsconfig.json               # Compiles src/ → dist/
│
├── infra/                          # CDK Infrastructure (API GW + Lambda)
│   ├── bin/infra.ts                # CDK App entry point
│   ├── lib/api-stack.ts            # ApiStack: Lambda + Alias + API Gateway
│   ├── test/api-stack.test.ts      # CDK Assertions unit tests (jest)
│   ├── cdk.json                    # CDK feature flags
│   ├── package.json                # aws-cdk-lib, jest, ts-jest
│   └── tsconfig.json
│
├── buildspec/
│   ├── buildspec-build.yaml        # Stage 2: npm ci + tsc + cdk synth
│   ├── buildspec-test.yaml         # Stage 3: CDK assertions + integration test
│   └── buildspec-predeploy.yaml    # Stage 4a: CFN deploy + generate appspec.yaml
│
├── pipeline/
│   ├── pipeline.yaml               # ⭐ Main CFN template — deploys the pipeline
│   └── appspec-template.yaml       # Static reference copy (educational)
│
└── README.md
```

---

## Pipeline Stages Explained

### Stage 1 — Source
- Provider: `CodeStarSourceConnection` (GitHub)
- Triggers on every push to the configured branch
- Downloads the repo as a ZIP artifact (`SourceArtifact`)

### Stage 2 — Build (`buildspec-build.yaml`)
```
npm ci --prefix app           # install TypeScript devDeps
npm run build --prefix app    # tsc → app/dist/index.js
npm ci --prefix infra         # install CDK + jest
cdk synth → cdk.out/          # generate CloudFormation template
```
Output: `BuildArtifact` (full workspace with `app/dist/` and `cdk.out/`)

### Stage 3 — Test (`buildspec-test.yaml`)

**Phase A — CDK Assertion Tests** (no AWS calls)
```
npm test --prefix infra       # jest reads cdk.out/ApiStack.template.json
                              # asserts: Lambda runtime, alias, API Gateway present
```

**Phase B — Integration Test**
```
aws cloudformation deploy → hello-api-TEST-stack
curl GET /  → assert HTTP 200
curl body   → assert JSON shape { message, version, timestamp, requestId }
aws cloudformation delete-stack hello-api-TEST-stack
```
> If either phase fails, CodePipeline stops here. Nothing reaches production.

### Stage 4 — Deploy

**Action 1: PreDeploy** (`buildspec-predeploy.yaml`, RunOrder: 1)
```
# 1. Capture current alias version (before CFN update)
aws lambda get-alias --name live → CURRENT_VERSION_ARN

# 2. Deploy production stack
aws cloudformation deploy → hello-api-prod-stack
  Creates: Lambda function + new Lambda Version + API Gateway

# 3. Read new version ARN from stack output
aws cloudformation describe-stacks → NEW_VERSION_ARN

# 4. Generate appspec.yaml
version: 0.0
Resources:
  - HelloFunction:
      CurrentVersion: <CURRENT_VERSION_ARN>
      TargetVersion:  <NEW_VERSION_ARN>
Hooks:
  - BeforeAllowTraffic: hello-api-function-before-hook
  - AfterAllowTraffic:  hello-api-function-after-hook
```
Output: `DeployArtifact` (contains `appspec.yaml`)

**Action 2: AllAtOnceTrafficShift** (CodeDeploy, RunOrder: 2)

Lifecycle:
```
1. Read appspec.yaml from DeployArtifact
2. Invoke BeforeAllowTraffic hook
   → Calls Lambda $LATEST with test payload → validates HTTP 200
   → Reports Succeeded/Failed to CodeDeploy
3. Shift alias "live": CurrentVersion ──► TargetVersion  (AllAtOnce, atomic)
4. Invoke AfterAllowTraffic hook
   → Calls GET /health via API Gateway → validates HTTP 200
   → Reports Succeeded/Failed to CodeDeploy
5. On any failure → auto-rollback alias to CurrentVersion
```

---

## Deployment Guide

### Prerequisites
- AWS CLI configured with sufficient permissions
- Node.js 20.x (for local testing)
- AWS CDK v2: `npm install -g aws-cdk`

### Step 1 — Push to GitHub

Push this repository to a GitHub repo you own:
```bash
git init
git remote add origin https://github.com/<your-username>/codepipeline-learn.git
git add .
git commit -m "initial commit"
git push -u origin main
```

### Step 2 — Deploy the Pipeline Stack

```bash
aws cloudformation deploy \
  --template-file pipeline/pipeline.yaml \
  --stack-name codepipeline-learn \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    GitHubOwner=<your-username> \
    GitHubRepo=codepipeline-learn \
    GitHubBranch=main \
    LambdaFunctionName=hello-api-function \
    ProdStackName=hello-api-prod-stack \
    TestStackName=hello-api-TEST-stack
```

### Step 3 — Authorize the GitHub Connection

> ⚠️ **Required manual step** — the pipeline will not start without this.

1. Go to **AWS Console → CodePipeline → Settings → Connections**
2. Find the connection named `github-codepipeline-learn` (status: `PENDING`)
3. Click **Update pending connection** → authorize via GitHub OAuth
4. Status changes to `AVAILABLE`

### Step 4 — Trigger the Pipeline

Push any commit to your main branch:
```bash
git commit --allow-empty -m "trigger pipeline"
git push
```

Watch the pipeline in the console:
- AWS Console → CodePipeline → `codepipeline-learn-pipeline`

---

## Local Development

### Compile the app
```bash
cd app
npm install
npm run build        # outputs to app/dist/
```

### Run CDK unit tests
```bash
cd infra
npm install
npm test             # runs CDK assertion tests via jest
```

### Synthesise the CloudFormation template
```bash
cd infra
npx cdk synth --output ../cdk.out --context stackName=hello-api-stack
cat ../cdk.out/ApiStack.template.json | jq '.'
```

### Deploy manually (without pipeline)
```bash
cd infra
npx cdk deploy --context stackName=hello-api-stack \
  --parameters FunctionName=hello-api-function
```

---

## Key Concepts Demonstrated

| Concept | Where |
|---|---|
| TypeScript → Lambda compilation | `app/` + `buildspec-build.yaml` |
| CDK infrastructure as code | `infra/lib/api-stack.ts` |
| `aws-cdk-lib/assertions` unit tests | `infra/test/api-stack.test.ts` |
| CDK synth → CloudFormation template | Buildspec Stage 2 |
| Ephemeral test stack (deploy + verify + teardown) | Buildspec Stage 3 |
| Lambda versioning + alias | `ApiStack.ts` — `currentVersion` + `Alias` |
| CodeDeploy AppSpec for Lambda | `pipeline/appspec-template.yaml` |
| Dynamic appspec generation | `buildspec-predeploy.yaml` |
| `BeforeAllowTraffic` lifecycle hook | `pipeline.yaml` — `BeforeAllowTrafficFunction` |
| `AfterAllowTraffic` lifecycle hook | `pipeline.yaml` — `AfterAllowTrafficFunction` |
| `AllAtOnce` traffic shift | `CodeDeployGroup` — `LambdaAllAtOnce` config |
| Auto-rollback on hook failure | `AutoRollbackConfiguration` in `CodeDeployGroup` |
| CodeStar GitHub connection | `GitHubConnection` resource |

---

## Cleanup

```bash
# Delete the pipeline stack
aws cloudformation delete-stack --stack-name codepipeline-learn

# Delete the production app stack (if deployed)
aws cloudformation delete-stack --stack-name hello-api-prod-stack

# Empty and delete the artifact bucket manually (required before CFN can delete it)
# The bucket has DeletionPolicy: Retain — delete manually if no longer needed
aws s3 rm s3://codepipeline-artifacts-<account-id>-<region> --recursive
```
