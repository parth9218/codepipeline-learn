#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

// The stack name can be overridden at synth time via: --context stackName=my-stack
const stackName = app.node.tryGetContext('stackName') ?? 'hello-api-stack';

new ApiStack(app, 'ApiStack', {
  stackName,
  // Use environment variables set by CodeBuild for account/region awareness.
  // When running locally, CDK uses your current AWS CLI profile.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region:  process.env.CDK_DEFAULT_REGION,
  },
  description: 'Hello API — API Gateway → Lambda (managed by CodePipeline)',
});

app.synth();
