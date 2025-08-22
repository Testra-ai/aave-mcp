import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS
  app.enableCors();

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const port = process.env.PORT || 8081;

  // DigitalOcean App Platform health check support
  await app.listen(port, "0.0.0.0");

  console.log(`
🚀 Aave MCP Server is running!
📍 Port: ${port} 
🔌 MCP Endpoint: http://localhost:${port}/mcp
🌐 Network: Base (Chain ID: 8453)
💎 Features: Aave V3, Uniswap V3, Smart Staking
🏗 Platform: ${process.env.PLATFORM || "Local"}
  `);
}

bootstrap();
