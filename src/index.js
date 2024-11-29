import {
    address,
    appendTransactionMessageInstruction,
    appendTransactionMessageInstructions,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    getBase58Encoder,
    createSolanaRpcSubscriptions,
    createTransactionMessage,
    getSignatureFromTransaction,
    isSolanaError,
    lamports,
    pipe,
    sendAndConfirmTransactionFactory,
    getBase64EncodedWireTransaction,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    getComputeUnitEstimateForTransactionMessageFactory,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
} from '@solana/web3.js';
import { getSystemErrorMessage, getTransferSolInstruction, isSystemError } from '@solana-program/system';
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';

async function sendTransaction() {

    const destinationAddress = address('public-key-to-send-lamports-to');
    const secretKey = "add-your-private-key";
    const sourceKeypair = await createKeyPairSignerFromBytes(
        getBase58Encoder().encode(secretKey)
    );

    const rpc_url = "https://mainnet.helius-rpc.com/?api-key=<api-key>";
    const wss_url = "wss://mainnet.helius-rpc.com/?api-key=<api-key>";

    const rpc = createSolanaRpc(rpc_url);
    const rpcSubscriptions = createSolanaRpcSubscriptions(wss_url);

    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
        rpc,
        rpcSubscriptions
    });

    /**
     * STEP 1: CREATE THE TRANSFER TRANSACTION
     */
    const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();

    const instruction = getTransferSolInstruction({
        amount: lamports(1),
        destination: destinationAddress,
        source: sourceKeypair,
    });

    const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        tx => (
            setTransactionMessageFeePayer(sourceKeypair.address, tx)
        ),
        tx => (
            setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx)
        ),
        tx =>
        appendTransactionMessageInstruction(
            instruction,
            tx,
        ),
    );
    console.log("Transaction message created");

    /**
     * STEP 2: SIGN THE TRANSACTION
     */
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    console.log("Transaction signed");

    /**
     * STEP 3: GET PRIORITY FEE FROM SIGNED TRANSACTION
     */

    const base64EncodedWireTransaction = getBase64EncodedWireTransaction(signedTransaction);

    const response = await fetch(rpc_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'helius-example',
            method: 'getPriorityFeeEstimate',
            params: [{
                transaction: base64EncodedWireTransaction,
                options: { 
                    transactionEncoding: "base64",
                    recommended: true,
                 }
            }]
        }),
    });
    const {result} = await response.json();
    const priorityFee = result.priorityFeeEstimate;
    console.log("Setting priority fee to ", priorityFee);

    /** 
     * STEP 4: OPTIMIZE COMPUTE UNITS
     */
     const getComputeUnitEstimateForTransactionMessage = getComputeUnitEstimateForTransactionMessageFactory({
        rpc
    });
    // Request an estimate of the actual compute units this message will consume.
    let computeUnitsEstimate = await getComputeUnitEstimateForTransactionMessage(transactionMessage);
    computeUnitsEstimate = (computeUnitsEstimate < 1000) ? 1000 : Math.ceil(computeUnitsEstimate * 1.1);
    console.log("Setting compute units to ", computeUnitsEstimate);

    /**
     * STEP 5: REBUILD AND SIGN FINAL TRANSACTION
     */
    const { value: finalLatestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();

    const finalTransactionMessage = appendTransactionMessageInstructions(
        [  
            getSetComputeUnitPriceInstruction({ microLamports: priorityFee }), 
            getSetComputeUnitLimitInstruction({ units: computeUnitsEstimate }) 
        ],
        transactionMessage,
    );

    setTransactionMessageLifetimeUsingBlockhash(finalLatestBlockhash, finalTransactionMessage);

    const finalSignedTransaction = await signTransactionMessageWithSigners(finalTransactionMessage);
    console.log("Rebuilded the transaction and signed it");

    /**
     * STEP 6: SEND AND CONFIRM THE FINAL TRANSACTION
     */
    try {
        console.log("Sending and confirming transaction");
        await sendAndConfirmTransaction(finalSignedTransaction, { commitment: 'confirmed', maxRetries: 0, skipPreflight: true});
        console.log('Transfer confirmed: ', getSignatureFromTransaction(finalSignedTransaction));
    } catch (e) {
        if (isSolanaError(e, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)) {
            const preflightErrorContext = e.context;
            const preflightErrorMessage = e.message;
            const errorDetailMessage = isSystemError(e.cause, finalTransactionMessage) ?
                getSystemErrorMessage(e.cause.context.code) : e.cause ? e.cause.message : '';
            logger.error(preflightErrorContext, '%s: %s', preflightErrorMessage, errorDetailMessage);
        } else {
            throw e;
        }
    }
}

sendTransaction();