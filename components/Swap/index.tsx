import { FC } from 'react'
import { Widget } from '../Widget/Index';
import { useSwapDataState } from '../../context/swap';
import Withdraw from './Withdraw';
import Processing from './Withdraw/Processing';
import { PublishedSwapTransactionStatus, TransactionType } from '../../lib/layerSwapApiClient';
import { SwapStatus } from '../../Models/SwapStatus';
import GasDetails from '../gasDetails';
import { useSettingsState } from '../../context/settings';

type Props = {
    type: "widget" | "contained",
}
import { useSwapTransactionStore } from '../store/zustandStore';

const SwapDetails: FC<Props> = ({ type }) => {
    const { swap } = useSwapDataState()
    const settings = useSettingsState()
    const swapStatus = swap?.status;
    const storedWalletTransactions = useSwapTransactionStore()

    const swapInputTransaction = swap?.transactions?.find(t => t.type === TransactionType.Input)
    const storedWalletTransaction = storedWalletTransactions.swapTransactions?.[swap?.id || '']

    const sourceNetwork = settings.layers.find(l => l.internal_name === swap?.source_network)
    const currency = settings.currencies.find(c => c.asset === swap?.source_network_asset)

    return (
        <>
            <Container type={type}>
                {
                    ((swapStatus === SwapStatus.UserTransferPending
                        && !(swapInputTransaction || (storedWalletTransaction && storedWalletTransaction.status !== PublishedSwapTransactionStatus.Error)))) ?
                        <Withdraw /> : <Processing />
                }
            </Container>
            {
                process.env.NEXT_PUBLIC_SHOW_GAS_DETAILS === 'true'
                && sourceNetwork
                && currency &&
                <GasDetails network={sourceNetwork} currency={currency} />
            }
        </>
    )
}

const Container = ({ type, children }: Props & {
    children: JSX.Element | JSX.Element[]
}) => {
    if (type === "widget")
        return <Widget><>{children}</></Widget>
    else
        return <div className="w-full flex flex-col justify-between h-full space-y-5 text-secondary-text">
            {children}
        </div>

}

export default SwapDetails