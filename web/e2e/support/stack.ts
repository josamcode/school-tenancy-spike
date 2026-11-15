// Where the stack under test listens. The global setup starts all three.
export const API_PORT = 3190;
export const WEB_PORT = 3290;
export const DEV_PORT = 3291;

export const API_URL = `http://localhost:${API_PORT}`;
// The production build: every test runs against it unless it says otherwise.
export const WEB_URL = `http://localhost:${WEB_PORT}`;
// The development server, which is the only place the demo sign-in exists.
export const DEV_URL = `http://localhost:${DEV_PORT}`;

export const JWT_SECRET = 'test_only_jwt_secret_0123456789abcdef';
export const SESSION_COOKIE = 'session';
