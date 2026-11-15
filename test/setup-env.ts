import { inject } from 'vitest';

process.env.DATABASE_URL = inject('databaseUrl');
process.env.JWT_SECRET = 'test_only_jwt_secret_0123456789abcdef';
