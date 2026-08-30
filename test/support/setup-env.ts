import { TEST_ADMIN_KEY } from './admin-key';

// ConfigModule.forRoot({ validate }) требует ADMIN_API_KEY ещё до компиляции
// AppModule — без него любой e2e-тест падает на старте, а не только тесты guard.
process.env.ADMIN_API_KEY = TEST_ADMIN_KEY;
