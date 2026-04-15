import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';

/**
 * Lambda handler for the Hello API.
 * Invoked by API Gateway on every request.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const appVersion = process.env.APP_VERSION ?? '1.0.0';
  const stage = event.requestContext?.stage ?? 'unknown';
  const path = event.path ?? '/';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-App-Version': appVersion,
    },
    body: JSON.stringify({
      message: 'Hello from CodePipeline! 🚀',
      version: appVersion,
      stage,
      path,
      timestamp: new Date().toISOString(),
      requestId: context.awsRequestId,
    }),
  };
};
