import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';

/**
 * ApiStack provisions:
 *   - Lambda Function (Node.js 20.x, TypeScript compiled)
 *   - Lambda Version  (CDK creates a new version every time the code hash changes)
 *   - Lambda Alias "live" (points to the current version; CodeDeploy shifts traffic here)
 *   - API Gateway REST API (backed by the alias, not $LATEST, to enable traffic shifting)
 *
 * CodeDeploy traffic-shifting flow:
 *   old version ──► alias "live" ◄── new version
 *                        │
 *                   API Gateway
 *
 * The alias is the single stable ARN exposed to API Gateway.
 * CodeDeploy atomically updates which version the alias resolves to.
 */
export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── CloudFormation Parameters ──────────────────────────────────────────────
    // Allows the same template to be deployed with different names for
    // test vs production stacks (buildspec overrides FunctionName parameter).
    const functionNameParam = new cdk.CfnParameter(this, 'FunctionName', {
      type: 'String',
      default: 'hello-api-function',
      description: 'Name of the deployed Lambda function. Override for test/prod stacks.',
    });

    // ── Lambda Function ────────────────────────────────────────────────────────
    const fn = new lambda.Function(this, 'HelloFunction', {
      functionName: functionNameParam.valueAsString,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      // Points to the compiled JS output from the app/ workspace.
      // The buildspec runs `npm run build` in app/ before `cdk synth`,
      // so app/dist/ is always up-to-date at synth time.
      code: lambda.Code.fromAsset(path.join(__dirname, '../../app/dist')),
      description: 'Hello API — traffic managed by CodeDeploy AllAtOnce',
      environment: {
        APP_VERSION: '1.0.0',
        NODE_ENV: 'production',
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
    });

    // ── Lambda Version ─────────────────────────────────────────────────────────
    // CDK creates a new AWS::Lambda::Version resource whenever the function's
    // code asset hash changes. This gives CodeDeploy a concrete immutable ARN
    // to shift traffic to (Lambda versions are immutable by design).
    const version = fn.currentVersion;

    // ── Lambda Alias "live" ────────────────────────────────────────────────────
    // The alias is the durable, stable ARN that:
    //   1. API Gateway always calls — no re-configuration needed between versions
    //   2. CodeDeploy updates atomically when shifting traffic
    const alias = new lambda.Alias(this, 'LiveAlias', {
      aliasName: 'live',
      version,
    });

    // ── API Gateway REST API ───────────────────────────────────────────────────
    // Backed by the *alias*, not $LATEST, so traffic shifting works correctly.
    const api = new apigw.RestApi(this, 'HelloApi', {
      restApiName: 'Hello API',
      description: 'REST API for the Hello Lambda (TypeScript)',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        metricsEnabled: true,
        tracingEnabled: true,
      },
    });

    const integration = new apigw.LambdaIntegration(alias, {
      allowTestInvoke: false,
    });

    // Root GET /
    api.root.addMethod('GET', integration);
    // Health-check endpoint GET /health — used by the AfterAllowTraffic hook
    api.root.addResource('health').addMethod('GET', integration);

    // ── Stack Outputs ──────────────────────────────────────────────────────────
    // Queried by the test buildspec for integration tests and by the
    // CloudFormation deploy action to surface the live API URL.
    // NOTE: Output construct IDs use the 'Out' suffix to avoid collision
    // with the 'FunctionName' CfnParameter construct in the same scope.

    new cdk.CfnOutput(this, 'ApiUrlOut', {
      value: api.url,
      description: 'API Gateway base URL',
      exportName: 'ApiUrl',
    });

    new cdk.CfnOutput(this, 'FunctionNameOut', {
      value: fn.functionName,
      description: 'Lambda function name',
      exportName: 'FunctionName',
    });

    new cdk.CfnOutput(this, 'AliasArnOut', {
      value: alias.functionArn,
      description: 'Lambda alias ARN — stable ARN called by API Gateway',
      exportName: 'AliasArn',
    });

    new cdk.CfnOutput(this, 'VersionArnOut', {
      value: version.functionArn,
      description: 'Current Lambda version ARN',
      exportName: 'VersionArn',
    });
  }
}
