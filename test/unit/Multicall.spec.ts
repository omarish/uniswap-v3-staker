import { LoadFixtureFunction } from '../types'
import {
  uniswapFixture,
  mintPosition,
  UniswapFixtureType,
} from '../shared/fixtures'
import {
  getMaxTick,
  getMinTick,
  FeeAmount,
  TICK_SPACINGS,
  blockTimestamp,
  BN,
  BNe18,
  snapshotGasCost,
  ActorFixture,
  makeTimestamps,
  maxGas,
} from '../shared'
import { createFixtureLoader, provider } from '../shared/provider'
import {
  HelperCommands,
  ERC20Helper,
  incentiveResultToStakeAdapter,
} from '../helpers'

import { ContractParams } from '../../types/contractParams'
import { createTimeMachine } from '../shared/time'

let loadFixture: LoadFixtureFunction

describe('unit.Multicall', async () => {
  const actors = new ActorFixture(provider.getWallets(), provider)
  const incentiveCreator = actors.incentiveCreator()
  const lpUser0 = actors.lpUser0()
  const amountDesired = BNe18(10)
  const totalReward = BNe18(100)
  const erc20Helper = new ERC20Helper()
  const Time = createTimeMachine(provider)
  let helpers: HelperCommands
  let context: UniswapFixtureType
  let timestamps: ContractParams.Timestamps

  before('loader', async () => {
    loadFixture = createFixtureLoader(provider.getWallets(), provider)
  })

  beforeEach('create fixture loader', async () => {
    context = await loadFixture(uniswapFixture)
    helpers = HelperCommands.fromTestContext(context, actors, provider)
  })

  /**
   * lpUser0 stakes and unstakes
   */
  let tokenId: string

  const multicaller = actors.traderUser2()

  it('is implemented', async () => {
    const currentTime = await blockTimestamp()

    await erc20Helper.ensureBalancesAndApprovals(
      multicaller,
      [context.token0, context.token1],
      amountDesired,
      context.nft.address
    )
    const tokenId = await mintPosition(context.nft.connect(multicaller), {
      token0: context.token0.address,
      token1: context.token1.address,
      fee: FeeAmount.MEDIUM,
      tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      recipient: multicaller.address,
      amount0Desired: amountDesired,
      amount1Desired: amountDesired,
      amount0Min: 0,
      amount1Min: 0,
      deadline: currentTime + 10_000,
    })

    await erc20Helper.ensureBalancesAndApprovals(
      multicaller,
      context.rewardToken,
      totalReward,
      context.staker.address
    )

    const createIncentiveTx = context.staker.interface.encodeFunctionData(
      'createIncentive',
      [
        {
          pool: context.pool01,
          rewardToken: context.rewardToken.address,
          refundee: incentiveCreator.address,
          ...makeTimestamps(currentTime + 100),
        },
        totalReward,
      ]
    )
    await context.staker
      .connect(multicaller)
      .multicall([createIncentiveTx], maxGas)

    // expect((await context.staker.deposits(tokenId)).owner).to.eq(
    //   multicaller.address
    // )
  })

  it('can be used to stake an already deposited token for multiple incentives', async () => {
    // const createIncentiveResult = await helpers.createIncentiveFlow({})
    // await helpers.mintDepositStakeFlow({
    //   lp: multicaller,
    //   tokensToStake: [context.token0, context.token1],
    //   amountsToStake: [amountDesired, amountDesired],
    //   ticks: [
    //     getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
    //     getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
    //   ],
    //   createIncentiveResult,
    // })
  })

  it('can be used to exit a position from multiple incentives', async () => {
    const { startTime, endTime } = makeTimestamps(await blockTimestamp(), 1000)
    const incentive0 = await helpers.createIncentiveFlow({
      rewardToken: context.token0,
      startTime,
      endTime,
      refundee: actors.incentiveCreator().address,
      totalReward: BN(10000),
      poolAddress: context.pool01,
    })
    const incentiveId0 = await helpers.getIncentiveId(incentive0)
    const incentive1 = await helpers.createIncentiveFlow({
      rewardToken: context.token1,
      startTime,
      endTime,
      refundee: actors.incentiveCreator().address,
      totalReward: BN(10000),
      poolAddress: context.pool01,
    })
    const incentiveId1 = await helpers.getIncentiveId(incentive1)

    await Time.set(startTime)

    const { tokenId } = await helpers.mintDepositStakeFlow({
      lp: lpUser0,
      tokensToStake: [context.token0, context.token1],
      amountsToStake: [amountDesired, amountDesired],
      ticks: [
        getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      ],
      createIncentiveResult: incentive0,
    })
    await context.staker
      .connect(lpUser0)
      .stakeToken(incentiveResultToStakeAdapter(incentive1), tokenId)

    await Time.set(endTime)

    const tx = context.staker
      .connect(lpUser0)
      .multicall([
        context.staker.interface.encodeFunctionData('unstakeToken', [
          incentiveResultToStakeAdapter(incentive0),
          tokenId,
        ]),
        context.staker.interface.encodeFunctionData('unstakeToken', [
          incentiveResultToStakeAdapter(incentive1),
          tokenId,
        ]),
        context.staker.interface.encodeFunctionData('withdrawToken', [
          tokenId,
          lpUser0.address,
        ]),
        context.staker.interface.encodeFunctionData('claimReward', [
          context.token0.address,
          lpUser0.address,
        ]),
        context.staker.interface.encodeFunctionData('claimReward', [
          context.token1.address,
          lpUser0.address,
        ]),
      ])
    await snapshotGasCost(tx)
  })

  it('can be used to exit multiple tokens from one incentive')
})