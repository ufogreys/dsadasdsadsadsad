import { erc20ABI } from 'wagmi';
import { encodeFunctionData, PublicClient, formatGwei, serializeTransaction, TransactionSerializedEIP1559 } from 'viem'
import { multicall, fetchBalance, FetchBalanceResult } from '@wagmi/core'
import { BaseL2Asset, Layer, NetworkAsset } from '../Models/Layer';
import { Currency } from '../Models/Currency';
import { getL1Fee } from '../lib/optimism/estimateFees';
import NetworkSettings, { GasCalculation } from '../lib/NetworkSettings';

export type ERC20ContractRes = ({
    error: Error;
    result?: undefined | null;
    status: "failure";
} | {
    error?: undefined | null;
    result: unknown;
    status: "success";
})

export type Balance = {
    network: string,
    amount: number,
    decimals: number,
    isNativeCurrency: boolean,
    token: string,
    request_time: string,
}

export type Gas = {
    token: string,
    gas: number,
    gasDetails?: {
        gasLimit?: number,
        maxFeePerGas?: number,
        gasPrice?: number,
        maxPriorityFeePerGas?: number
    },
    request_time: string
}

type ResolveGasArguments = {
    publicClient: PublicClient,
    chainId: number,
    contract_address: `0x${string}`,
    account: `0x${string}`,
    from: Layer & { isExchange: false },
    currency: Currency,
    destination: `0x${string}`
    nativeToken: NetworkAsset,
    isSweeplessTx: boolean
}

export const resolveFeeData = async (publicClient: PublicClient) => {

    let gasPrice = await getGasPrice(publicClient);
    let feesPerGas = await estimateFeesPerGas(publicClient)
    let maxPriorityFeePerGas = await estimateMaxPriorityFeePerGas(publicClient)

    return {
        gasPrice,
        maxFeePerGas: feesPerGas?.maxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFeePerGas
    }
}

const getGasPrice = async (publicClient: PublicClient) => {
    try {
        return await publicClient.getGasPrice()

    } catch (e) {
        //TODO: log the error to our logging service
        console.log(e)
    }
}
const estimateFeesPerGas = async (publicClient: PublicClient) => {
    try {
        return await publicClient.estimateFeesPerGas()

    } catch (e) {
        //TODO: log the error to our logging service
        console.log(e)
    }
}
const estimateMaxPriorityFeePerGas = async (publicClient: PublicClient) => {
    try {
        return await publicClient.estimateMaxPriorityFeePerGas()

    } catch (e) {
        //TODO: log the error to our logging service
        console.log(e)
    }
}


export const resolveERC20Balances = async (
    multicallRes: ERC20ContractRes[],
    from: Layer & { isExchange: false },
) => {
    const assets = from?.assets?.filter(a => a.contract_address && a.status !== 'inactive')
    if (!assets)
        return null
    const contractBalances = multicallRes?.map((d, index) => {
        const currency = assets[index]
        return {
            network: from.internal_name,
            token: currency.asset,
            amount: formatAmount(d.result, currency.decimals),
            request_time: new Date().toJSON(),
            decimals: currency.decimals,
            isNativeCurrency: false,
        }
    })
    return contractBalances
}
type GetBalanceArgs = {
    address: string,
    chainId: number,
    assets: NetworkAsset[],
    publicClient: PublicClient,
    hasMulticall: boolean
}
export const getErc20Balances = async ({
    address,
    chainId,
    assets,
    publicClient,
    hasMulticall = false
}: GetBalanceArgs): Promise<ERC20ContractRes[] | null> => {

    const contracts = assets?.filter(a => a.contract_address && a.status !== 'inactive').map(a => ({
        address: a?.contract_address as `0x${string}`,
        abi: erc20ABI,
        functionName: 'balanceOf',
        args: [address],
    }))

    try {
        if (hasMulticall) {
            const contractRes = await multicall({
                chainId: chainId,
                contracts: contracts
            })
            return contractRes
        }
        else {
            const balances: ERC20ContractRes[] = []
            for (let i = 0; i < contracts.length; i++) {
                try {
                    const contract = contracts[i]
                    const balance = await publicClient.readContract({
                        address: contract?.address as `0x${string}`,
                        abi: erc20ABI,
                        functionName: 'balanceOf',
                        args: [address as `0x${string}`]
                    })
                    balances.push({
                        status: "success",
                        result: balance,
                        error: undefined
                    })
                }
                catch (e) {
                    balances.push({
                        status: "failure",
                        result: null,
                        error: e?.message
                    })
                }
            }
            return balances
        }
    }
    catch (e) {
        //TODO: log the error to our logging service
        console.log(e);
        return null;
    }

}

export const getNativeBalance = async (address: `0x${string}`, chainId: number): Promise<FetchBalanceResult | null> => {

    try {
        const nativeTokenRes = await fetchBalance({
            address,
            chainId
        })
        return nativeTokenRes
    } catch (e) {
        //TODO: log the error to our logging service
        console.log(e)
        return null
    }

}

export const resolveNativeBalance = async (
    from: Layer & { isExchange: false },
    nativeTokenRes: FetchBalanceResult
) => {
    const native_currency = from.assets.find(a => a.asset === from.native_currency)
    if (!native_currency) {
        return null
    }

    const nativeBalance: Balance = {
        network: from.internal_name,
        token: native_currency.asset,
        amount: formatAmount(nativeTokenRes?.value, native_currency.decimals),
        request_time: new Date().toJSON(),
        decimals: native_currency.decimals,
        isNativeCurrency: true,
    }

    return nativeBalance
}

export const estimateNativeGasLimit = async ({ publicClient, account, destination }: ResolveGasArguments) => {
    const to = destination;
    const gasEstimate = await publicClient.estimateGas({
        account: account,
        to: to,
        data: constructSweeplessTxData(),
    })

    return gasEstimate
}

export const estimateERC20GasLimit = async ({ publicClient, contract_address, account, destination, isSweeplessTx }: ResolveGasArguments) => {
    let encodedData = encodeFunctionData({
        abi: erc20ABI,
        functionName: "transfer",
        args: [destination, BigInt(1000)]
    })

    if (encodedData && isSweeplessTx) {
        encodedData = constructSweeplessTxData(encodedData)
    }

    const estimatedERC20GasLimit = await publicClient.estimateGas({
        data: encodedData,
        to: contract_address,
        account
    });

    return estimatedERC20GasLimit
}

const GetOpL1Fee = async ({ publicClient, chainId, destination, contract_address, isSweeplessTx }: ResolveGasArguments): Promise<bigint> => {
    const amount = BigInt(1000)
    let serializedTransaction: TransactionSerializedEIP1559

    if (contract_address) {
        let encodedData = encodeFunctionData({
            abi: erc20ABI,
            functionName: "transfer",
            args: [destination, amount]
        })

        if (encodedData && isSweeplessTx) {
            encodedData = constructSweeplessTxData(encodedData)
        }

        serializedTransaction = serializeTransaction({
            client: publicClient,
            abi: erc20ABI,
            functionName: "transfer",
            chainId: chainId,
            args: [destination, amount],
            to: contract_address,
            data: encodedData,
            type: 'eip1559',
        }) as TransactionSerializedEIP1559
    }
    else {
        serializedTransaction = serializeTransaction({
            client: publicClient,
            chainId: chainId,
            to: destination,
            data: constructSweeplessTxData(),
            type: 'eip1559',
        }) as TransactionSerializedEIP1559
    }

    const fee = await getL1Fee({
        data: serializedTransaction,
        client: publicClient,
    })

    return fee;
}

export const resolveGas = async (options: ResolveGasArguments) => {
    const feeData = await resolveFeeData(options.publicClient)

    const estimatedGasLimit = options.contract_address ?
        await estimateERC20GasLimit(options)
        : await estimateNativeGasLimit(options)

    const multiplier = feeData.maxFeePerGas || feeData.gasPrice

    if (!multiplier)
        return undefined

    let totalGas = multiplier * estimatedGasLimit

    const gasCalculationType = NetworkSettings.KnownSettings[options.from.internal_name].GasCalculationType

    if (gasCalculationType == GasCalculation.OptimismType) {
        totalGas += await GetOpL1Fee(options);
    }
    const formattedGas = formatAmount(totalGas, options.nativeToken?.decimals)
    return {
        gas: formattedGas,
        token: options.currency?.asset,
        gasDetails: {
            gasLimit: Number(estimatedGasLimit),
            maxFeePerGas: feeData?.maxFeePerGas ? Number(formatGwei(feeData?.maxFeePerGas)) : undefined,
            gasPrice: feeData?.gasPrice ? Number(formatGwei(feeData?.gasPrice)) : undefined,
            maxPriorityFeePerGas: feeData?.maxPriorityFeePerGas ? Number(formatGwei(feeData?.maxPriorityFeePerGas)) : undefined,
        },
        request_time: new Date().toJSON()
    }
}

export const formatAmount = (unformattedAmount: bigint | unknown, decimals: number) => {
    return (Number(BigInt(unformattedAmount?.toString() || 0)) / Math.pow(10, decimals))
}

// Data is just "0x" for a non-contract (native token) transaction
const constructSweeplessTxData = (txData: string = "0x") => {
    const hexed_sequence_number = (99999999).toString(16)
    const sequence_number_even = hexed_sequence_number?.length % 2 > 0 ? `0${hexed_sequence_number}` : hexed_sequence_number
    return `${txData}${sequence_number_even}` as `0x${string}`;
}