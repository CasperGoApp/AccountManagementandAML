const APP = require('gnodejs') // get the app

module.exports = {  // export the controller
  getTotalDeposited: async (CONTROLLERS, userID) => { // get the total deposited
    const oneMonth = new Date() // get the current date
    oneMonth.setMonth(oneMonth.getMonth() - 1)  // set the date to one month ago
    const depositList = await CONTROLLERS.mgo.query(  // get the deposit list
      CONTROLLERS.db, // the database
      'depositRecords', // the collection
      { user: CONTROLLERS.mgo.id(userID), on: { $gt: oneMonth } } // the query
    ) 
    let totalAmount = 0 // the total amount
    for (let i = 0; i < depositList.length; i++) {  // loop through the deposit list
      totalAmount += depositList[i].amountUSD // add the amount to the total
    } 
    return totalAmount // return the total amount
  }, // end getTotalDeposited
  getTotalWithdrawn: async (CONTROLLERS, userID, months, days) => { // get the total withdrawn
    const since = new Date()  // get the current date
    if (months) { // if there are months
      since.setMonth(since.getMonth() - months) // set the date to the months ago
    } 
    if (days) { // if there are days
      since.setDate(since.getDate() - days) // set the date to the days ago
    } 
    const withdrawlList = await CONTROLLERS.mgo.query(  // get the withdrawl list
      CONTROLLERS.db, // the database
      'withdrawlRecords', // the collection
      { user: CONTROLLERS.mgo.id(userID), on: { $gt: since } }  // the query
    )
    let totalAmount = 0 // the total amount
    for (let i = 0; i < withdrawlList.length; i++) {  // loop through the withdrawl list
      totalAmount += withdrawlList[i].amountUSD // add the amount to the total
    }
    return totalAmount  // return the total amount
  },
  addToLog: async (CONTROLLERS, coin, wallet, amount, list) => {  // add to the log
    let isBlocked = null  // the isBlocked variable to check if the wallet is blocked
    const txs = []  // the txs variable to store the transactions
    let thisAmount = 0  // the thisAmount variable to store the amount
    let thisAmountUSD = 0 // the thisAmountUSD variable to store the amount in USD
    for (let i = 0; i < list.length; i++) { // loop through the list
      if (list[i].block > 0 && !list[i].out) {  // if the transaction is in the block chain
        list[i].wallet = CONTROLLERS.mgo.id(wallet._id) // set the wallet
        list[i].user = CONTROLLERS.mgo.id(wallet.user)  // set the user
        list[i].coin = wallet.coin  // set the coin
        list[i].on = new Date() // set the date
        list[i].amountUSD = CONTROLLERS.prices.convertCrypto( // convert the amount
          coin, // the coin
          list[i].amount, // the amount
          'usd' // the currency
        ) 
        thisAmount += list[i].amount  // add the amount to the total
        thisAmountUSD += list[i].amountUSD  // add the amount to the total
        txs.push(list[i]) // add the transaction to the txs
      } 
    } 
    if (txs.length > 0) { // if there are transactions
      await CONTROLLERS.mgo.insert(CONTROLLERS.db, 'depositRecords', txs) // insert the transactions
      if (wallet.type == 'auto') {  // if the wallet is auto
        const userData = await CONTROLLERS.mgo.singleQuery( // get the user data
          CONTROLLERS.db, // the database
          'Users',  // the collection
          { _id: CONTROLLERS.mgo.id(wallet.user) }  // the query
        ) 
        const totalDepositedMonth = await module.exports.getTotalDeposited(   // get the total deposited
          CONTROLLERS,  // the controllers  
          wallet.user // the user
        )
        if (userData.aml && userData.aml.limit) { // if the user has an AML limit
          const myKYCLimit = parseFloat(userData.aml.limit) // get the limit
          if (myKYCLimit < totalDepositedMonth) { // if the limit is less than the total deposited
            const dataToUpdate = userData.aml // get the data to update
            const amlCode = APP.randomString(20)  // get the aml code
            dataToUpdate.block = true // set the block to true
            if (!dataToUpdate.blockCoins) { // if the block coins is not set
              dataToUpdate.blockCoins = {}  // set the block coins to an empty object
            } 
            //sum blocked total for each coin
            //DO NOT block the whole thisAmount if they do not have a prior blocked amount, only do the difference
            const priorBlocked = parseFloat(  // get the prior blocked amount
              dataToUpdate.blocked ? dataToUpdate.blocked : 0 // the prior blocked amount
            ) 
            dataToUpdate.blocked = totalDepositedMonth - myKYCLimit // set the blocked amount
            const differenceInBlock = dataToUpdate.blocked - priorBlocked // get the difference in block
            const differenceInBlockCoin = CONTROLLERS.prices.fiatToCrypto(  // get the difference in block coin
              wallet.coin,  // the coin
              differenceInBlock,  // the difference in block
              'usd' // the currency
            ) 
            dataToUpdate.blockCoins[coin] = parseFloat( // set the block coin
              (
                (dataToUpdate.blockCoins[coin]  // get the block coin
                  ? dataToUpdate.blockCoins[coin] // get the block coin
                  : 0) +  // get the block coin
                (differenceInBlockCoin > thisAmount   // if the difference in block coin is greater than the thisAmount
                  ? thisAmount  // get the thisAmount
                  : differenceInBlockCoin)  // get the difference in block coin
              ).toFixed(8)  // round the number
            )
            await CONTROLLERS.mgo.update( // update the user
              CONTROLLERS.db, // the database
              'Users',  // the collection
              { _id: CONTROLLERS.mgo.id(userData._id) },  // the query
              { aml: dataToUpdate, amlCode }  // the data to update
            )
            const linkCode = await CONTROLLERS.shortLink.add( // add the short link
              'https://caspergo.io/blocked/' + amlCode, // the link
              3 * 60  // the time
            ) 
            isBlocked = // set the isBlocked
              '. Please open https://caspergo.io/' +  // the blocked message
              linkCode +  // the link code
              ' to receive this transaction'  // set the isBlocked
          }
        }
      }
    }
    return isBlocked // return the isBlocked
  },
  addToOutboundLog: async (CONTROLLERS, coin, wallet, list) => {  // add to outbound log
    const txs = []  // the txs
    for (let i = 0; i < list.length; i++) { // for each tx
      if (wallet._id) { // if there is a wallet
        list[i].wallet = CONTROLLERS.mgo.id(wallet._id) // the wallet
      } 
      list[i].user = CONTROLLERS.mgo.id(wallet.user)  // the user
      list[i].coin = wallet.coin  // the coin
      list[i].on = new Date() // the on
      list[i].amountUSD = CONTROLLERS.prices.convertCrypto( // the amount in USD
        coin, // the coin
        list[i].amount, // the amount
        'usd' // the to
      ) 
      txs.push(list[i]) // add the tx
    }
    if (txs.length > 0) { // if there are txs
      await CONTROLLERS.mgo.insert(CONTROLLERS.db, 'withdrawlRecords', txs) // insert the txs
    } // insert the txs
  }
}
