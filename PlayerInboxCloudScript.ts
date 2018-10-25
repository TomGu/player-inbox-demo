///////////////////////////////////////////////
// JenkinsConsoleUtility CloudScript functions
///////////////////////////////////////////////

//var TEST_TITLE_ID: string = "6195"; // NOTE: Replace this with your own titleID - DeleteUsers has an additional security check to avoid accidents
//var TEST_DATA_KEY: string = "TEST_DATA_KEY"; // Used to reuse args.customId, but it was kindof a pain, and made things fragile

//@todo: move these to some better place for constants? (title data?)
var MAX_MESSAGES: number = 20;
var INBOX_KEY: string = "playerInbox";
var INBOX_SIZE_KEY: string = "playerInboxSize";

var HelloWorld = function (args: IHelloWorldRequest, context): IHelloWorldResult {
    var message: string = "Hello " + currentPlayerId + "!";
    log.info(message);
    var inputValue: any = null;
    if (args && args.hasOwnProperty("inputValue"))
        inputValue = args.inputValue;
    log.debug("helloWorld:", { input: inputValue });
    return { messageValue: message };
};
interface IHelloWorldRequest {
    inputValue?: any
}
interface IHelloWorldResult {
    messageValue: string
}
handlers["helloWorld"] = HelloWorld;

var SendMessage = function (args: any, context: IPlayFabContext): ISendMessageResponse {

    // The pre-defined "currentPlayerId" variable is initialized to the PlayFab ID of the player logged-in on the game client. 
    // Cloud Script handles authenticating the player automatically.
    var message = "Send Message from " + currentPlayerId + "!";
    //server.GetPlayerProfile.

    // You can use the "log" object to write out debugging statements. It has
    // three functions corresponding to logging level: debug, info, and error. These functions
    // take a message string and an optional object.
    log.info(message);
    var messageFromRequest = null;
    if (args && args.message)
        messageFromRequest = args.message;
    log.debug("sendMessage:", { input: args.message });

    return { messageValue: messageFromRequest };
}
interface ISendMessageResponse {
    messageValue: string;
}
handlers["sendMessage"] = SendMessage;


var MessageToPlayerOld = function (args: any, context: IPlayFabContext) {

    var MAX_MESSAGES: number = 20;
    var currentUserIndexData: PlayFabServerModels.UserDataRecord = server.GetUserData({ "PlayFabId": currentPlayerId, "Keys": ["currentInboxIndex"], }).Data["currentInboxIndex"];
    var currentIndex: number;
    if (currentUserIndexData) {
        currentIndex = +currentUserIndexData.Value;
    } else {
        currentIndex = 0;
    }

    args.toPlayerId;
    args.messageText;

    // @TODO - store index of max message and add new messages after index.  later clean up all messages before index - 100
    // new plan: create circular buffer of messages

    var messageKey: string = "Message_" + currentIndex;
    var fromKey: string = "FromPlayer_" + currentIndex;

    var newIndex: number = ((currentIndex + 1) % MAX_MESSAGES);

    var dataPayload = {};
    dataPayload[messageKey] = args.messageText;
    dataPayload[fromKey] = currentPlayerId;
    dataPayload["currentInboxIndex"] = String(newIndex);

    var updateDataRequest: PlayFabServerModels.UpdateUserDataRequest = {
        PlayFabId: args.toPlayerId,
        Data: dataPayload,
        "Permission": "Private"
    };

    server.UpdateUserReadOnlyData(updateDataRequest);
}


class inboxMessage {
    sender: string;
    body: string;
    sendDate: Date;
    messageId: string;
}

class playerInbox {
    messages: inboxMessage[];
    constructor() { this.messages = new Array<inboxMessage>(0); } 
}

var MessageToPlayer = function (args: any, context: IPlayFabContext) {

    //@todo: verify size of message is < 1KB

    var userDataResult: PlayFabServerModels.GetUserDataResult = server.GetUserInternalData({
        "PlayFabId": args.toPlayerId,
        "Keys": [
            INBOX_KEY,
            INBOX_SIZE_KEY
        ],
    });

    // number of messages in the recipient's inbox
    var currentInboxSize: number = 0;
    if (userDataResult.Data[INBOX_SIZE_KEY]) {
        currentInboxSize = +(userDataResult.Data[INBOX_SIZE_KEY].Value);
    }

    // full contents of the recipient's inbox
    var currentInbox: playerInbox = new playerInbox();
    if (userDataResult.Data[INBOX_KEY]) {
        currentInbox = JSON.parse(userDataResult.Data[INBOX_KEY].Value); //@todo: deal with parsing errors
    }

    if (currentInboxSize >= MAX_MESSAGES) {
        log.error("Player Inbox Full");
        // @todo: return error, stop processing
    }
    
    var newMessage: inboxMessage = {
        sender: currentPlayerId,
        body: args.messageText,
        sendDate: new Date(),
        messageId: String(currentInboxSize), //@Todo - Generate random GUID
    }

    currentInbox.messages.push(newMessage);

    var dataPayload = {};
    dataPayload[INBOX_KEY] = JSON.stringify( currentInbox );
    dataPayload[INBOX_SIZE_KEY] = String(currentInboxSize + 1);

    var updateDataRequest: PlayFabServerModels.UpdateUserDataRequest = {
        PlayFabId: args.toPlayerId,
        Data: dataPayload, 
        "Permission": "Private"
    };

    server.UpdateUserInternalData(updateDataRequest);

}
handlers["messageToPlayer"] = MessageToPlayer;


var GetMessages = function (args: any, context: IPlayFabContext): IGetMessagesResult {

    //@todo: verify size of message is < 1KB

    var userDataResult: PlayFabServerModels.GetUserDataResult = server.GetUserInternalData({
        "PlayFabId": currentPlayerId,
        "Keys": [
            INBOX_KEY,
            INBOX_SIZE_KEY
        ],
    });

    // full contents of the recipient's inbox
    var currentInbox: playerInbox = new playerInbox();
    if (userDataResult.Data[INBOX_KEY]) {
        currentInbox = JSON.parse(userDataResult.Data[INBOX_KEY].Value); //@todo: deal with parsing errors
    }

    return { messageList: currentInbox };
}
handlers["getMessages"] = GetMessages;

interface IGetMessagesResult {
    messageList: playerInbox;
}

var ThrowError = function (args: void): void {
    var testObject: any = undefined;
    var failureObj: any = testObject.doesnotexist.doesnotexist;
    return failureObj; // Can't get to here
}
handlers["throwError"] = ThrowError;

var EasyLogEvent = function (args: IEasyLogEvent): void {
    log.info(JSON.stringify(args.logMessage));
};
interface IEasyLogEvent {
    logMessage: string
}
handlers["easyLogEvent"] = EasyLogEvent;