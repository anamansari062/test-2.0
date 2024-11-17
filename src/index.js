import {
    address,
    appendTransactionMessageInstruction,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    createTransactionMessage,
    getSignatureFromTransaction,
    isSolanaError,
    lamports,
    pipe,
    sendAndConfirmTransactionFactory,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    prependTransactionMessageInstruction,
    signTransactionMessageWithSigners,
    getComputeUnitEstimateForTransactionMessageFactory,
    SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
    compileTransactionMessage,
    getCompiledTransactionMessageEncoder,
    getBase64Decoder,
    getBase58Encoder,
    getBase58Decoder
} from '@solana/web3.js';
import { getSystemErrorMessage, getTransferSolInstruction, isSystemError } from '@solana-program/system';
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import base58 from 'bs58';

async function sendTransaction() {

    const secretKey = "2Jx2WB3EavNht461S1upHcmH4ubafEPF25mB7qy9MRZxvprbqtD7oewxjJPueqZfeoQdckuUXyGwqt6QffkXb56Q";
    const toPubkey = address('F6mARiS4WMUkcEK9ah93tRhqaf6HUBG9s7LPP8LQ5aU4');
    const fromKeypair = await createKeyPairSignerFromBytes(
        base58.decode(secretKey)
    );

    const rpc_url = "https://mainnet.helius-rpc.com/?api-key=973e45f2-38c8-4d67-bf71-5affc1415138";
    const wss_url = "wss://mainnet.helius-rpc.com/?api-key=973e45f2-38c8-4d67-bf71-5affc1415138";

    const rpc = createSolanaRpc(rpc_url);
    const rpcSubscriptions = createSolanaRpcSubscriptions(wss_url);

    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
        rpc,
        rpcSubscriptions
    });


    /**
     * STEP 1: CREATE THE TRANSFER TRANSACTION
     */
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        tx => (
            setTransactionMessageFeePayer(fromKeypair.address, tx)
        ),
        tx => (
            setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx)
        ),
        tx =>
        appendTransactionMessageInstruction(
            getTransferSolInstruction({
                amount: lamports(1),
                destination: toPubkey,
                source: fromKeypair,
            }),
            tx,
        ),
    );
    console.log("Transaction message created");

    /**
     * STEP 2: ADD PRIORITY FEE
     */

    const base64EncodedMessage = pipe(
        // Start with the message you want the fee for.
        transactionMessage,

        // Compile it.
        compileTransactionMessage,

        // Convert the compiled message into a byte array.
        getCompiledTransactionMessageEncoder().encode,

        // Encode that byte array as a base64 string.
        getBase58Decoder().decode,
    );

    // const transactionCost = await rpc
    //     .getFeeForMessage(base64EncodedMessage)
    //     .send();

    // console.log("Transaction is estimated to cost " + transactionCost.value + " lamports");

    // Fetch the priority fee using serialized transaction
    console.log("Serialized transaction: ", base64EncodedMessage);
    const response = await fetch(rpc_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'helius-example',
            method: 'getPriorityFeeEstimate',
            params: [{
                transaction: base64EncodedMessage,
                options: { recommended: true }
            }]
        }),
    });
    const result = await response.json();
    // const priorityFee = result.priorityFeeEstimate;
    console.log("Setting priority fee to ", result);

    // Set the transaction message's priority fee.
    const transactionMessageWithPriorityFee = prependTransactionMessageInstruction(
        getSetComputeUnitPriceInstruction({ microLamports: priorityFee }),
        transactionMessage,
    );

    /** 
     * STEP 3: OPTIMIZE COMPUTE UNITS
     */
    const getComputeUnitEstimateForTransactionMessage = getComputeUnitEstimateForTransactionMessageFactory({
        rpc
    });
    // Request an estimate of the actual compute units this message will consume.
    var computeUnitsEstimate = await getComputeUnitEstimateForTransactionMessage(transactionMessage);
    computeUnitsEstimate = (computeUnitsEstimate < 1000) ? 1000 : computeUnitsEstimate;
    console.log("Setting compute units to ", computeUnitsEstimate);

    // Set the transaction message's compute unit budget.
    const transactionMessageWithCompute = prependTransactionMessageInstruction(
        getSetComputeUnitLimitInstruction({ units: computeUnitsEstimate }),
        transactionMessageWithPriorityFee,
    );

    /**
     * STEP 4: SIGN THE TRANSACTION
     */
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessageWithCompute);
    console.log("Transaction signed");

    /**
     * STEP 5: SEND AND CONFIRM THE TRANSACTION
     */
    try {
        console.log("Sending and confirming transaction");
        await sendAndConfirmTransaction(signedTransaction, { commitment: 'confirmed' });
        console.log('Transfer confirmed: ', getSignatureFromTransaction(signedTransaction));
    } catch (e) {
        if (isSolanaError(e, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)) {
            const preflightErrorContext = e.context;
            const preflightErrorMessage = e.message;
            const errorDetailMessage = isSystemError(e.cause, transactionMessage) ?
                getSystemErrorMessage(e.cause.context.code) : e.cause ? e.cause.message : '';
            console.error(preflightErrorContext, '%s: %s', preflightErrorMessage, errorDetailMessage);
        } else {
            throw e;
        }
    }
}

sendTransaction();