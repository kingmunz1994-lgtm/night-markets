import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  localSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  voterNightBalance(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
}

export type ImpureCircuits<PS> = {
  createListing(context: __compactRuntime.CircuitContext<PS>,
                orderId_0: Uint8Array,
                amountNight_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  fundEscrow(context: __compactRuntime.CircuitContext<PS>,
             orderId_0: Uint8Array,
             amountNight_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  releaseEscrow(context: __compactRuntime.CircuitContext<PS>,
                orderId_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  disputeEscrow(context: __compactRuntime.CircuitContext<PS>,
                orderId_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  refundEscrow(context: __compactRuntime.CircuitContext<PS>,
               orderId_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  castVote(context: __compactRuntime.CircuitContext<PS>,
           proposalId_0: Uint8Array,
           choice_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
}

export type ProvableCircuits<PS> = {
  createListing(context: __compactRuntime.CircuitContext<PS>,
                orderId_0: Uint8Array,
                amountNight_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  fundEscrow(context: __compactRuntime.CircuitContext<PS>,
             orderId_0: Uint8Array,
             amountNight_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  releaseEscrow(context: __compactRuntime.CircuitContext<PS>,
                orderId_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  disputeEscrow(context: __compactRuntime.CircuitContext<PS>,
                orderId_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  refundEscrow(context: __compactRuntime.CircuitContext<PS>,
               orderId_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  castVote(context: __compactRuntime.CircuitContext<PS>,
           proposalId_0: Uint8Array,
           choice_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  createListing(context: __compactRuntime.CircuitContext<PS>,
                orderId_0: Uint8Array,
                amountNight_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  fundEscrow(context: __compactRuntime.CircuitContext<PS>,
             orderId_0: Uint8Array,
             amountNight_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  releaseEscrow(context: __compactRuntime.CircuitContext<PS>,
                orderId_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  disputeEscrow(context: __compactRuntime.CircuitContext<PS>,
                orderId_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  refundEscrow(context: __compactRuntime.CircuitContext<PS>,
               orderId_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  castVote(context: __compactRuntime.CircuitContext<PS>,
           proposalId_0: Uint8Array,
           choice_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
}

export type Ledger = {
  escrow_state: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): number;
    [Symbol.iterator](): Iterator<[Uint8Array, number]>
  };
  seller_commit: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  buyer_commit: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  amount_night: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  vote_for: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  vote_against: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  vote_abstain: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
