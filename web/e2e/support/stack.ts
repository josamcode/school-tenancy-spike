// Where the stack under test listens. The global setup starts all three.
export const API_PORT = 3190;
export const WEB_PORT = 3290;
export const DEV_PORT = 3291;
export const RECEIVER_PORT = 3390;

export const API_URL = `http://localhost:${API_PORT}`;
// The production build: every test runs against it unless it says otherwise.
export const WEB_URL = `http://localhost:${WEB_PORT}`;
// The development server, which is the only place the demo sign-in exists.
export const DEV_URL = `http://localhost:${DEV_PORT}`;

// The fake webhook receiver. The worker posts to it and a test asks it what it
// recorded. Only the development server is told where it is.
export const RECEIVER_URL = `http://127.0.0.1:${RECEIVER_PORT}`;

export const JWT_SECRET = 'test_only_jwt_secret_0123456789abcdef';
export const SESSION_COOKIE = 'session';
