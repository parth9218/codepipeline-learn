import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ApiStack } from '../lib/api-stack';

/**
 * CDK Assertion Tests for ApiStack
 *
 * These tests run against the *synthesised CloudFormation template* — no AWS
 * credentials or real deployments needed. They verify that the CDK stack
 * produces the expected CloudFormation resources with correct property values.
 *
 * In the pipeline:
 *   Build stage → cdk synth → generates template
 *   Test stage  → jest       → assertions on that template (this file)
 */
describe('ApiStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new ApiStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  // ── Lambda Function ──────────────────────────────────────────────────────────
  test('creates exactly one Lambda function', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });

  test('Lambda uses Node.js 20.x runtime', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Handler: 'index.handler',
    });
  });

  test('Lambda has a 10-second timeout', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 10,
    });
  });

  test('Lambda has APP_VERSION environment variable', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          APP_VERSION: '1.0.0',
        },
      },
    });
  });

  // ── Lambda Version & Alias ───────────────────────────────────────────────────
  test('creates exactly one Lambda version (for CodeDeploy traffic shifting)', () => {
    template.resourceCountIs('AWS::Lambda::Version', 1);
  });

  test('creates a Lambda alias named "live"', () => {
    template.hasResourceProperties('AWS::Lambda::Alias', {
      Name: 'live',
    });
  });

  // ── API Gateway ──────────────────────────────────────────────────────────────
  test('creates an API Gateway REST API named "Hello API"', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'Hello API',
    });
  });

  test('API Gateway has at least one GET method', () => {
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
    });
  });

  // ── CloudFormation Outputs ───────────────────────────────────────────────────
  test('stack exports ApiUrl output', () => {
    template.hasOutput('ApiUrl', {});
  });

  test('stack exports FunctionName output', () => {
    template.hasOutput('FunctionName', {});
  });

  test('stack exports AliasArn output', () => {
    template.hasOutput('AliasArn', {});
  });

  test('stack exports VersionArn output', () => {
    template.hasOutput('VersionArn', {});
  });
});
