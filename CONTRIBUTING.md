# Contributing to AAVE MCP

Thank you for your interest in contributing to the AAVE MCP server! This document provides guidelines and instructions for contributing to this project.

## Code of Conduct

Please be respectful and considerate of others when contributing to this project. We aim to foster an inclusive and welcoming community.

## How to Contribute

### Reporting Bugs

If you find a bug, please create an issue on GitHub with the following information:

- A clear, descriptive title
- A detailed description of the bug
- Steps to reproduce the bug
- Expected behavior
- Actual behavior
- Any relevant logs or screenshots
- Your environment (OS, Node.js version, etc.)

### Suggesting Enhancements

If you have an idea for an enhancement, please create an issue on GitHub with the following information:

- A clear, descriptive title
- A detailed description of the enhancement
- Any relevant examples or mockups
- Why this enhancement would be useful

### Pull Requests

1. Fork the repository
2. Create a new branch for your feature or bugfix (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests to ensure your changes don't break existing functionality
5. Commit your changes (`git commit -m 'Add some amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request. Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) as your PR's title.

## Development Setup

1. Clone your fork of the repository
2. Install dependencies: `npm install`
3. Create a `.env` file with your credentials (see README.md)
4. Build the project: `npm run build`
5. Test the MCP server: `npm test`

## Coding Standards

- Follow the existing code style
- Write clear, descriptive commit messages
- Add comments to your code where necessary
- Write tests for new features
- Update documentation when necessary

## Adding New Tools

If you want to add a new tool to the AAVE MCP server, follow these steps:

### 1. Create the Tool Service

Create a new service file in the appropriate module directory:

```typescript
// src/[module]/[tool-name].service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class YourToolService {
  async executeTool(params: any) {
    // Tool implementation
  }
}
```

### 2. Register in MCP Service

Add your tool to the MCP service (`src/mcp/mcp.service.ts`):

```typescript
{
  name: 'your_tool_name',
  description: 'Tool description',
  inputSchema: {
    type: 'object',
    properties: {
      // Define your parameters
    },
    required: ['param1', 'param2']
  }
}
```

### 3. Add Tool Handler

Implement the tool handler in the MCP service:

```typescript
case 'your_tool_name':
  return await this.yourToolService.executeTool(args);
```

### 4. Update Documentation

- Add your tool to the README.md tools section
- Include example usage
- Add any necessary configuration details

## Testing Guidelines

### Unit Tests

- Write unit tests for all new functions
- Aim for >80% code coverage
- Test both success and error cases

### Integration Tests

- Test API endpoints
- Test blockchain interactions with mock providers
- Test swap and DeFi operations

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:cov

# Run tests in watch mode
npm run test:watch
```

## DeFi-Specific Guidelines

When working with DeFi protocols:

### Security First

- ⚠️ Always validate user inputs
- Implement slippage protection
- Use transaction simulation before execution
- Never expose private keys in code

### Gas Optimization

- Estimate gas before transactions
- Use efficient contract calls
- Batch operations when possible

### Protocol Integration

- Follow Aave V3 documentation
- Handle protocol-specific errors
- Keep APY calculations accurate
- Use correct token addresses

## Commit Message Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes
- `refactor:` Code refactoring
- `test:` Test additions or fixes
- `chore:` Maintenance tasks

Examples:
```
feat: add support for new LST token
fix: correct slippage calculation in smart stake
docs: update API documentation for swap endpoints
```

## Recognition

Contributors will be recognized in:

- The project README
- Release notes
- Special contributor badges

## Getting Help

If you need help:

- Check existing issues and discussions
- Read the documentation
- Ask in GitHub Discussions
- Contact the maintainers

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Create a GitHub release
4. Build and push Docker images
5. Publish to npm (if applicable)

## License

By contributing to AAVE MCP, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to AAVE MCP! Your efforts help make DeFi more accessible through AI integration.