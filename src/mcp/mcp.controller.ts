import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  Req,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import type { Response, Request } from "express";
import { McpService } from "./mcp.service";
import type { McpRequest } from "./mcp.service";

@ApiTags("MCP Protocol")
@Controller("mcp")
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly mcpService: McpService) {}

  /**
   * Get MCP server information
   */
  @Get()
  @ApiOperation({ summary: "Get MCP server information and available tools" })
  @ApiResponse({
    status: 200,
    description: "MCP server information with tools list"
  })
  getMcpInfo() {
    // Return simplified format compatible with http-stdio-proxy
    const tools = this.mcpService.getTools();
    return {
      name: "aave-mcp",
      version: "1.0.0",
      protocol_version: "2024-11-05", // Use protocol_version not protocolVersion
      endpoint: "/mcp",
      status: "ready",
      tools: tools.map(t => t.name) // Return only tool names, not full schemas
    };
  }

  /**
   * SSE endpoint for MCP over HTTP (remote mode)
   */
  @Get("sse")
  @Header("Content-Type", "text/event-stream")
  @Header("Cache-Control", "no-cache")
  @Header("Connection", "keep-alive")
  @Header("X-Accel-Buffering", "no")
  @ApiOperation({
    summary: "MCP Server-Sent Events endpoint for remote Claude Desktop",
  })
  async handleMcpSse(@Res() response: Response, @Req() request: Request) {
    this.logger.log("MCP SSE connection established");

    // Send initial connection message
    response.write(
      `data: ${JSON.stringify({
        jsonrpc: "2.0",
        method: "connection/ready",
        params: {
          serverInfo: {
            name: "aave-mcp",
            version: "1.0.0",
            protocolVersion: "2024-11-05",
          },
        },
      })}\n\n`,
    );

    // Send capabilities
    response.write(
      `data: ${JSON.stringify({
        jsonrpc: "2.0",
        method: "capabilities/update",
        params: {
          capabilities: {
            tools: {},
            completion: {
              models: ["aave-mcp"],
            },
          },
        },
      })}\n\n`,
    );

    // Keep connection alive
    const keepAlive = setInterval(() => {
      response.write(":keepalive\n\n");
    }, 30000);

    // Handle client disconnect
    request.on("close", () => {
      this.logger.log("MCP SSE connection closed");
      clearInterval(keepAlive);
    });

    // Process incoming messages via POST to /mcp/message
  }

  /**
   * Handle MCP messages for SSE transport
   */
  @Post("message")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send MCP request via HTTP POST" })
  @ApiResponse({ status: 200, description: "MCP response" })
  async handleMcpMessage(@Body() request: McpRequest) {
    this.logger.log(`MCP Message: ${request.method}`);
    return await this.mcpService.handleRequest(request);
  }

  /**
   * Standard HTTP POST endpoint for MCP (alternative to SSE)
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send MCP request via standard HTTP POST" })
  @ApiResponse({ status: 200, description: "MCP response" })
  async handleMcpPost(@Body() request: McpRequest) {
    return await this.mcpService.handleRequest(request);
  }

  /**
   * List all available MCP tools
   */
  @Get("tools")
  @ApiOperation({ summary: "Get list of all available MCP tools" })
  @ApiResponse({
    status: 200,
    description: "List of MCP tools with schemas",
  })
  getTools() {
    return {
      tools: this.mcpService.getTools(),
    };
  }

  /**
   * Full server info endpoint with complete schemas
   */
  @Get("info")
  @ApiOperation({ summary: "Get full MCP server information with schemas" })
  @ApiResponse({
    status: 200,
    description: "Complete MCP server information",
  })
  getFullInfo() {
    return {
      name: "aave-mcp",
      version: "1.0.0",
      description: "Aave V3 MCP Server for Base network",
      protocol: "MCP",
      protocolVersion: "2024-11-05",
      transport: ["http", "sse", "stdio"],
      tools: this.mcpService.getTools(),
      endpoints: {
        sse: "/mcp/sse",
        post: "/mcp",
        tools: "/mcp/tools",
        health: "/mcp/health",
        info: "/mcp/info"
      }
    };
  }

  /**
   * Health check for MCP server
   */
  @Get("health")
  @ApiOperation({ summary: "MCP server health check" })
  @ApiResponse({ status: 200, description: "MCP server is healthy" })
  getMcpHealth() {
    return {
      status: "healthy",
      protocol: "MCP",
      version: "2024-11-05",
      transport: ["stdio", "sse", "http"],
      timestamp: new Date().toISOString(),
    };
  }
}
