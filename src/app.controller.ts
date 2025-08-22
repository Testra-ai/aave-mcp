import { Controller, Get } from "@nestjs/common";
import { AppService } from "./app.service";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getInfo() {
    return {
      name: 'Aave MCP Server',
      version: '1.0.0',
      status: 'operational',
      chain: 'Base',
      endpoints: ['/mcp', '/mcp/sse', '/mcp/message', '/mcp/tools', '/mcp/info', '/mcp/health']
    };
  }
}
