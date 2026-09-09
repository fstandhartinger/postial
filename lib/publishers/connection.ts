import { PublishError, type Credentials, type Publisher } from './types';
/** The connection form is a credential check; publishing an existing target needs reconnect guidance. */
export async function validateConnection(publisher: Publisher, credentials: Credentials) {
  try { return await publisher.validate(credentials); }
  catch (error) {
    if (error instanceof PublishError && error.code === 'AUTH_EXPIRED')
      throw new PublishError({code: error.code, retryable: false,
        humanMessage: 'Check the token/app password and scopes, then connect again.'});
    throw error;
  }
}
