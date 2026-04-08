if (process.env.NODE_ENV === "production") {
  console.error("ERROR: Seed script cannot run in production.");
  process.exit(1);
}

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 12);

  await prisma.user.upsert({
    where: { email: "dev@ivm.local" },
    update: {},
    create: {
      email: "dev@ivm.local",
      name: "Dev User",
      passwordHash,
    },
  });

  console.log("Seed complete: dev@ivm.local / password123");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
