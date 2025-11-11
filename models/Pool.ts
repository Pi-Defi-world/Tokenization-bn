
export interface ILiquidityPoolLink {
  href: string;
  templated?: boolean;
}

export interface ILiquidityPoolAssetReserve {
  asset: string;
  amount: string;
}

export interface ILiquidityPool {
  _links: {
    self: ILiquidityPoolLink;
    transactions: ILiquidityPoolLink;
    operations: ILiquidityPoolLink;
  };
  id: string;
  paging_token: string;
  fee_bp: number;
  type: string;
  total_trustlines: string;
  total_shares: string;
  reserves: ILiquidityPoolAssetReserve[];
  last_modified_ledger: number;
  last_modified_time: string;
}
