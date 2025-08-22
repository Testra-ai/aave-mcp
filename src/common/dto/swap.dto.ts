import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNumber, IsOptional, Min, Max } from "class-validator";
import { Type } from "class-transformer";

export class SwapDto {
  @ApiProperty({ description: "Token to swap from", example: "USDT" })
  @IsString()
  fromToken: string;

  @ApiProperty({ description: "Token to swap to", example: "USDC" })
  @IsString()
  toToken: string;

  @ApiProperty({ description: "Amount to swap", example: "100" })
  @IsString()
  amount: string;

  @ApiProperty({ description: "User wallet address", example: "0x..." })
  @IsString()
  userAddress: string;

  @ApiProperty({
    description: "Maximum slippage percentage",
    default: 1,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(5)
  maxSlippage?: number = 1;
}

export class QuoteDto {
  @ApiProperty({ description: "Token to swap from", example: "USDT" })
  @IsString()
  fromToken: string;

  @ApiProperty({ description: "Token to swap to", example: "USDC" })
  @IsString()
  toToken: string;

  @ApiProperty({ description: "Amount to swap", example: "100" })
  @IsString()
  amount: string;
}
