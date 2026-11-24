import { PrismaClient } from "@prisma/session-client";

if (process.env.NODE_ENV !== "production") {
  if (!global.sessionPrismaGlobal) {
    global.sessionPrismaGlobal = new PrismaClient();
  }
}

const sessionDb = global.sessionPrismaGlobal ?? new PrismaClient();

export default sessionDb;
