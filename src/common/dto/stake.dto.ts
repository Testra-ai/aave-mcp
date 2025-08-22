import { ApiProperty } from "@nestjs/swagger";
import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  Min,
  Max,
} from "class-validator";
import { Type } from "class-transformer";

export class StakeDto {
  @ApiProperty({
    description: "Asset symbol to stake (e.g., USDC, USDT)",
    example: "USDC",
  })
  @IsString()
  asset: string;

  @ApiProperty({ description: "Amount to stake", example: "10" })
  @IsString()
  amount: string;

  @ApiProperty({ description: "User wallet address", example: "0x..." })
  @IsString()
  userAddress: string;

  @ApiProperty({
    description: "Allow automatic token swap if needed",
    default: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  allowSwap?: boolean = true;

  @ApiProperty({
    description: "Maximum slippage percentage for swaps",
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

export class SmartStakeDto extends StakeDto {
  @ApiProperty({
    description: "Target asset to stake after swap",
    example: "USDC",
    required: false,
  })
  @IsOptional()
  @IsString()
  targetAsset?: string;

  @ApiProperty({
    description: "Target amount to stake (when using targetAsset)",
    example: "10",
    required: false,
  })
  @IsOptional()
  @IsString()
  targetAmount?: string;
}

export class WithdrawDto {
  @ApiProperty({ description: "Asset symbol to withdraw", example: "USDC" })
  @IsString()
  asset: string;

  @ApiProperty({
    description: 'Amount to withdraw (use "max" for full amount)',
    example: "10",
  })
  @IsString()
  amount: string;

  @ApiProperty({ description: "User wallet address", example: "0x..." })
  @IsString()
  userAddress: string;
}

export class BorrowDto {
  @ApiProperty({ description: "Asset symbol to borrow", example: "USDT" })
  @IsString()
  asset: string;

  @ApiProperty({ description: "Amount to borrow", example: "100" })
  @IsString()
  amount: string;

  @ApiProperty({
    description: "Interest rate mode (1=stable, 2=variable)",
    example: 2,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(2)
  rateMode: number;

  @ApiProperty({ description: "User wallet address", example: "0x..." })
  @IsString()
  userAddress: string;
}

export class RepayDto {
  @ApiProperty({ description: "Asset symbol to repay", example: "USDT" })
  @IsString()
  asset: string;

  @ApiProperty({
    description: 'Amount to repay (use "max" for full debt)',
    example: "100",
  })
  @IsString()
  amount: string;

  @ApiProperty({
    description: "Interest rate mode (1=stable, 2=variable)",
    example: 2,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(2)
  rateMode: number;

  @ApiProperty({ description: "User wallet address", example: "0x..." })
  @IsString()
  userAddress: string;
}
