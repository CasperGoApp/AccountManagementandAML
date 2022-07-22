const APP = require('gnodejs') // import gnodejs

//which coins will be based on a UTXO blockchain
const UTXOCoinList = ['btc', 'divi']

//all coins available to enable
const coinList = [
  'btc',
  'divi',
  'cspr'
]

//add function for export and use in the platform
module.exports = async (CONTROLLERS, wallet, number, route, language, cur) => { // addAccount
  //get existing user with this phone number
  const existing = await CONTROLLERS.mgo.singleQuery(CONTROLLERS.db, 'Users', { // getUser
    number, // phone number
    route // route
  })
  //if user exists, cancel process
  if (existing) { // if user exists
    return null // return null
  }
  //get last user (to manage the private keys using an index)
  const lastUser = await CONTROLLERS.mgo.queryLimitSort( //get last user
    CONTROLLERS.db,                                       //db
    'Users',                                            //collection
    1,                                                  //limit
    { added: -1 },                                    //sort
    {}                                                //query
  )
  //set wallet index for next user to last user + 1
  const walletIndex =
    (lastUser && lastUser.length == 1 && lastUser[0] && lastUser[0].walletIndex
      ? lastUser[0].walletIndex
      : 200) + 1  // set wallet index
  let referred = null // set referred to null
  //get referral information with this phone number
  const referral = await CONTROLLERS.mgo.singleQuery( // get referral
    CONTROLLERS.db,                                 // db
    'referrals',                                 // collection
    {
      phoneNumber: number,               // phone number
      active: true,                     // active
      expiresOn: { $gt: new Date() },  // expires on
      holdReleased: { $exists: false }, // hold released
      redeemed: { $exists: false }    // redeemed
    }
  )
  //if referral exists, enter to the process
  if (referral) { // if referral exists
    // Set referred information witht the date, by who was refered and id
    referred = { // referred
      on: new Date(),                              // on
      by: CONTROLLERS.mgo.id(referral.user),     // by
      id: CONTROLLERS.mgo.id(referral._id)  // id
    }
    //get from which Account ( payFromAccount ) will pay the user
    const payFromAccount = await CONTROLLERS.mgo.singleQuery( // get payFromAccount
      CONTROLLERS.db,                                // db
      'Wallets',                                  // collection
      {                                            // query
        user: CONTROLLERS.mgo.id(referral.user),  // user
        coin: referral.coin,                    // coin
        type: 'auto',                           // type
        active: true,                         // active
        held: { $gt: 0 }                        // held
      }
    )
    //if payFromAccount exists, enter to the process
    if (payFromAccount) { // if payFromAccount exists
      // Get from which user will get the payment
      const fromUser = await CONTROLLERS.mgo.singleQuery( // get fromUser
        CONTROLLERS.db,                               // db
        'Users',  // collection
        { _id: CONTROLLERS.mgo.id(referral.user) }  // query
      )
      // Verify the type of Coin and held amount should be equal to or more that the amount to send
      if (  
        referral.coin == 'divi' &&  // if coin is divi
        payFromAccount.held >= referral.amountToSend  // if held amount is equal or more than the amount to send
      ) {
        referred.amount = referral.amountToSend // set referred amount to the amount to send
        // Made the update on the Wallet table about the transaction made
        await CONTROLLERS.mgo.update( // update
          CONTROLLERS.db, // db
          'Wallets',  // collection
          {
            _id: CONTROLLERS.mgo.id(payFromAccount._id) // query
          }, 
          {
            held: payFromAccount.held - referral.amountToSend,  // held
            staking: payFromAccount.staking - referral.amountToSend // staking
          }
        )
        // Made the update on the Referrals table about the transaction made
        await CONTROLLERS.mgo.update( // update
          CONTROLLERS.db, // db
          'referrals',  // collection
          {
            _id: CONTROLLERS.mgo.id(referral._id) // query
          },
          {
            active: false,               // active
            redeemed: new Date()       // redeemed
          }
        )

        // Send a message from the transaccion made
        await CONTROLLERS.messages.message( // message
          fromUser.route, // route
          fromUser.number,  // number
          fromUser.language,  // language
          'shareReceivedDeposit', // message
          [
            referral.phoneNumber, // phone number
            'CasperGo', // app
            CONTROLLERS.prices.formatCrypto(  // amount
              'divi', // coin
              referral.amountToSend,  // amount
              fromUser.cur  // currency
            )
          ]
        )
      }
    }
  }

  // Add new user
  const newUser = await CONTROLLERS.mgo.insert(CONTROLLERS.db, 'Users', { // addUser
    added: new Date(),                               // added
    number,                                       // number
    route,                                     // route
    active: true,                              // active
    language,                                // language
    cur,                                   // currency
    walletIndex,                         // walletIndex
    referred                         // referred
  }) 
  const addresses = [] // set addresses to empty array
  for (let i = 0; i < coinList.length; i++) { // for each coin
    // Get the next address available
    const addr = await CONTROLLERS.getNextAddress( // getNextAddress
      CONTROLLERS,                               // CONTROLLERS
      wallet,                                 // wallet
      coinList[i],                           // coin
      walletIndex                           // walletIndex
    )
    const addrData = { // addrData
      user: CONTROLLERS.mgo.id(newUser.insertedId), // user
      coin: coinList[i],                         // coin
      added: new Date(),                        // added
      type: 'auto',                            // type
      address: addr,                        // address
      active: true                         // active
    }
    addrData.index = walletIndex  // index
    if (UTXOCoinList.includes(coinList[i])) { // if UTXO coin
      CONTROLLERS.daemons.addAddress(coinList[i], addr) // add address to daemon
    } else {  // if coin is not UTXO
      addrData.address = addrData.address.split(':')[0] // address
    }
    if (coinList[i].toLowerCase() == 'divi') {  // if coin is divi
      addrData.staking = referred && referred.amount ? referred.amount : 0  // staking
    } 
    if (  // if coin is not UTXO
      referral.coin == coinList[i] && // if referral coin is the same as the coin
      payFromAccount.balance <= referral.amountToSend // if payFromAccount balance is less than or equal to the amount to send
    ) {
      console.log('send', referral, 'to', addrData.address) // send
    }
    addresses.push(addrData)  // push address
  }
  await CONTROLLERS.mgo.insert(CONTROLLERS.db, 'Wallets', addresses)  // add addresses
  const uniqueSettingsCode = APP.randomString(7)  // set uniqueSettingsCode
  const settingsExpires = new Date()  // settingsExpires
  settingsExpires.setHours(settingsExpires.getHours() + 12) // settingsExpires
  await CONTROLLERS.mgo.update( // update
    CONTROLLERS.db, // db
    'Users',  // collection
    { _id: CONTROLLERS.mgo.id(newUser.insertedId) },  // query
    { settingsCode: uniqueSettingsCode, settingsExpires } // update
  ) 
  const linkCode = await CONTROLLERS.shortLink.add( // add
    'https://caspergo.io/start/' + uniqueSettingsCode,  // url
    3 * 60
  ) 
  await CONTROLLERS.messages.message(route, number, language, 'onboard', [  // message
    'CasperGo', // app
    'To configure advanced settings, please click here: https://caspergo.io/' +  // link
      linkCode +  // link
      (referred && referred.amount && referred.amount > 0 
        ? ", What's more? You have also received " +  // if referral amount is greater than 0
          CONTROLLERS.prices.formatCrypto(referral.coin, referred.amount, cur) +  // referral amount
          ' from your friend just for joining!' // referral amount
        : '') // referral amount
  ])  
  setTimeout( // setTimeout
    _ => CONTROLLERS.messages.message(route, number, language, 'menu', []), // message
    20 * 1000 // 20 seconds
  ) 
  CONTROLLERS.setUsedAddresses(CONTROLLERS) // setUsedAddresses
  return newUser.insertedId // return newUser
} 
