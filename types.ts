import { Document, Types } from "mongoose";

type ObjectId = Types.ObjectId;

export interface IAssetRecord {
  _links: {
    toml: {
      href: string;
    };
  };
  asset_type: string;
  asset_code: string;
  asset_issuer: string;
  paging_token: string;
  num_claimable_balances: number;
  num_liquidity_pools: number;
  num_contracts: number;
  accounts: {
    authorized: number;
    authorized_to_maintain_liabilities: number;
    unauthorized: number;
  };
  claimable_balances_amount: string;
  liquidity_pools_amount: string;
  contracts_amount: string;
  balances: {
    authorized: string;
    authorized_to_maintain_liabilities: string;
    unauthorized: string;
  };
  flags: {
    auth_required: boolean;
    auth_revocable: boolean;
    auth_immutable: boolean;
    auth_clawback_enabled: boolean;
  };
}

export interface IToml extends Document {
  assetCode: string;
  issuer: string;
  distribution?: string;

  name: string;
  description?: string;
  imgUrl?: string;
  totalSupply: number;

  network?: string;

  conditions?: string;
  status?: string;
  anchorAssetType?: string;
  displayDecimals?: number;
  isAssetAnchored?: boolean;
  redemptionInstructions?: string;

  orgName?: string;
  orgUrl?: string;
  orgDescription?: string;

}


export interface IUser extends Document {
  id: string;
  uid: string;
  username: string;
  public_key?: string;
  avatarUrl: string;
  tokens: ObjectId[];
  liquidityPools: ObjectId[];
  liquidityPoolInvestments?: {
    poolId: ObjectId;
    amount: string;
    lpTokens: string;
  }[];
  role: 'user' | 'creator' | 'admin';
  verified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAuthResult {
  accessToken: string;
  user :{
      username: string;
      uid: string;
  }
}

export interface IToken extends Document {
  name: string;
  assetCode:string,
  distributor:string,
  homeDomain:string,
  issuer:string
  user:ObjectId
  description: string;
  totalSupply: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface ICreateTokenPayload{
  name:string
  user:ObjectId
  description: string;
  totalSupply: number;
}

export type LaunchStatus =
  | 'draft'
  | 'participation_open'
  | 'participation_closed'
  | 'allocation_running'
  | 'tge_open';

export type AllocationDesign = 1 | 2;

export interface ITokenAsset {
  code: string;
  issuer: string;
}

export interface ILaunchDoc {
  _id: ObjectId;
  projectId: string;
  projectAppUrl?: string;
  teamVestingSchedule?: string;
  tokenAsset: ITokenAsset;
  T_available: string;
  participationWindowStart?: Date;
  participationWindowEnd?: Date;
  stakeDurationDays: number;
  allocationDesign: AllocationDesign;
  status: LaunchStatus;
  escrowPublicKey?: string;
  escrowLocked?: boolean;
  poolId?: string;
  tgeAt?: Date;
  listingPrice?: string;
  PiPowerBaseline?: string;
  createdBeforeCutoff: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IParticipationDoc {
  _id: ObjectId;
  launchId: ObjectId;
  userId: string;
  stakedPi: string;
  committedPi: string;
  piPower: string;
  engagementScore: number;
  engagementRank: number;
  allocatedTokens: string;
  effectivePrice: string;
  tier?: 'top' | 'mid' | 'bottom';
  swapOrder?: number;
  lockupEnd?: Date;
  createdAt: Date;
  updatedAt: Date;
}








