import { json } from './errors';
export const notFound = () => json({error: {code: 'not_found', message: 'API endpoint not found.'}}, 404);
export const methodNotAllowed = (allow: string) => () => {
  const response = json({error: {code: 'method_not_allowed', message: 'Method not allowed.'}}, 405);
  response.headers.set('Allow', allow);
  return response;
};
export const options = (allow: string) => () => {
  const response = json({methods: allow.split(', ') });
  response.headers.set('Allow', allow);
  return response;
};
