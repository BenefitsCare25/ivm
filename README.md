# IVM -- Intelligent Value Mapper

AI-powered document-to-form autofill platform.

## Local Development

### Prerequisites
- Node.js 20+
- Docker & Docker Compose

### Setup

1. Copy environment variables:
   ```bash
   cp .env.example .env
   ```

2. Start infrastructure:
   ```bash
   docker-compose up -d
   ```

3. Install dependencies and setup database:
   ```bash
   npm install
   npx prisma migrate dev
   npx prisma db seed
   ```

4. Run the dev server:
   ```bash
   npm run dev
   ```

5. Open http://localhost:3000

### Default Credentials (dev seed)
- Email: `dev@ivm.local`
- Password: `password123`
