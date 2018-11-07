
//@todo: move these to some better place for constants? (title data?)
var MAX_MESSAGES: number = 10;
//var INBOX_KEY: string = "playerInbox";
var INBOX_FILENAME: string = "player_inbox.json";
var INBOX_VERSION: number = 1;

/*
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
}*/

/*var MessageToPlayerOld = function (args: any, context: IPlayFabContext) {

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
}*/

class inboxMessage {
    sender: string;
    body: string;
    sendDate: Date;
    messageId: string;
}

class playerInbox {
    //@todo: add format version number?
    inboxVersion: number = INBOX_VERSION;
    messages: inboxMessage[];
    constructor() { this.messages = new Array<inboxMessage>(0) } 
}


var GetInboxFromFile = function (targetEntity: PlayFabAuthenticationModels.EntityKey): playerInbox {
    log.debug("GetMessagesFromFile called for entity: " + targetEntity.Id + " " + targetEntity.Type);
    var targetInbox: playerInbox = new playerInbox();

    // var targetEntity: PlayFabDataModels.EntityKey = { "Id": playerId, "Type": "master_player_account" };
    //var getFilesRequest: PlayFabDataModels.GetFilesRequest = { Entity: targetEntity };
    var getFilesResult: PlayFabDataModels.GetFilesResponse = entity.GetFiles({ Entity: targetEntity });
    
    log.debug("Got file list for Entity " + getFilesResult.Entity.Id);

    if (getFilesResult.Metadata[INBOX_FILENAME] == null) {
        log.debug("Player does not have an inbox, returning a new inbox.")
        return targetInbox;
    }

    log.debug("Filename: " + getFilesResult.Metadata[INBOX_FILENAME].FileName);
    log.debug("DownloadUrl: " + getFilesResult.Metadata[INBOX_FILENAME].DownloadUrl);
    //log.debug("Size: " + getFilesResult.Metadata[INBOX_FILENAME].Size);
    //log.debug("LastModified: " + getFilesResult.Metadata[INBOX_FILENAME].LastModified);

    var fileURL: string = getFilesResult.Metadata[INBOX_FILENAME].DownloadUrl;

    var response = http.request(fileURL, "GET", "", 'application/json', {});
   
    if (response != null) {
        targetInbox = JSON.parse(response.toString()); //@todo: deal with parsing errors
    }

    return targetInbox;
}

/*var GetMessagesFromUserData = function (playerId: string): playerInbox {
    log.debug("***** Deprecated GetMessagesFromUserData called ******");

    var userDataResult: PlayFabServerModels.GetUserDataResult = server.GetUserInternalData({
        "PlayFabId": playerId,
        "Keys": [
            INBOX_KEY
        ],
    });

    // full contents of the recipient's inbox
    var currentInbox: playerInbox = new playerInbox();
    if (userDataResult.Data[INBOX_KEY]) {
        currentInbox = JSON.parse(userDataResult.Data[INBOX_KEY].Value); //@todo: deal with parsing errors
    }
    return currentInbox;
}*/

var GetMessages = function (args: any, context: IPlayFabContext): playerInbox {

    var myInbox: playerInbox = GetInboxFromFile(context.currentEntity.Entity);

    var startIndex: number = 0;
    var endIndex: number = myInbox.messages.length;
    var lastMessageKey: string = args.lastReceivedKey;
    var returnLimit: number = args.limit;
    var moreMessages: boolean = false;

    if (lastMessageKey != null && lastMessageKey != "") {

        var lastMessageKey: string = args.lastReceivedKey;
        log.debug("Getting messages newer than " + lastMessageKey);

        for (var i: number = 0; i < myInbox.messages.length; i++) {
            if (lastMessageKey == myInbox.messages[i].messageId) {
                startIndex = i+1;
                log.debug("Found message at index " + i);
                break;
            }
        }
    }

    if (returnLimit != null) {
        endIndex = Math.min(endIndex, startIndex + returnLimit);
        log.debug("Limit specified: " + returnLimit + " - New endIndex is: " + endIndex);
    }

    if (endIndex < myInbox.messages.length) {
        moreMessages = true; //@todo: add to return value
    }

    log.debug(
        "GetMessages is returning a range of messages from " +
        startIndex +
        " to " + endIndex +
        ". Total inbox size was " + myInbox.messages.length +
        ". More messages to get = " + moreMessages +
        " Last message key was [" + lastMessageKey + "]"
    );

    myInbox.messages = myInbox.messages.slice(startIndex, endIndex); 

    return myInbox;
}
handlers["getMessages"] = GetMessages;


function storeInbox(currentInbox: playerInbox, targetEntity: PlayFabAuthenticationModels.EntityKey) {

    //var targetEntity: PlayFabDataModels.EntityKey = { "Id": targetPlayer, "Type": "master_player_account" }; //@todo: figure out master vs. title account usage here

    var initFileUploadRequest: PlayFabDataModels.InitiateFileUploadsRequest = {
        Entity: targetEntity,
        FileNames: [INBOX_FILENAME]
    };

    log.debug("Init File Upload FileNames: " + initFileUploadRequest.FileNames);
    
    //initFileUploadRequest.ProfileVersion = oldVersion;//@todo - may want to do this
    var initResponse: PlayFabDataModels.InitiateFileUploadsResponse = entity.InitiateFileUploads(initFileUploadRequest);

    log.debug("Init File Upload response: " + JSON.stringify(initResponse.UploadDetails));
    log.debug("Upload URL: " + initResponse.UploadDetails[0].UploadUrl );
   
    var putResponse = http.request(initResponse.UploadDetails[0].UploadUrl, "PUT", JSON.stringify(currentInbox), 'application/json', {});

    log.debug("http put response: " + putResponse);

    var finalFileUploadRequest: PlayFabDataModels.FinalizeFileUploadsRequest = {
        Entity: targetEntity,
        FileNames: [INBOX_FILENAME]
    };

    var finalResponse: PlayFabDataModels.FinalizeFileUploadsResponse = entity.FinalizeFileUploads(finalFileUploadRequest);

   // log.debug(finalResponse.Metadata[0].FileName + " uploaded. New LastModified = " + finalResponse.Metadata[0].LastModified);

}

// from: https://stackoverflow.com/questions/105034/create-guid-uuid-in-javascript
function generateUUID() : string { // Public Domain/MIT 
    var d = new Date().getTime();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (d + Math.random() * 16) % 16 | 0;
        d = Math.floor(d / 16);
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

var SendMessage = function (args: any, context: IPlayFabContext): ISendMessageResult {

    var messageBody: string = args.messageText;

    if (messageBody.length>1000) {
        log.error("Message body too large: " + messageBody.length );//@todo: use better check on message size < 1KB
        return null;
        // @todo: message error better
    }

    var messageRecipientId: string = args.toPlayerId;

    if (messageRecipientId == null || 0 == +messageRecipientId) {
        log.error("Invalid message recipient passed: " + messageRecipientId);
        return null;
        // @todo: message error better
    }

    var targetEntityKey: PlayFabAuthenticationModels.EntityKey = getTitlePlayerEntityKey(messageRecipientId);

    // get contents of the recipient's inbox
    var targetInbox: playerInbox = GetInboxFromFile(targetEntityKey);

    // check if the inbox is already full
    if (targetInbox.messages.length >= MAX_MESSAGES) {
        log.error("Player Inbox Full");
        throw "Error: Player inbox is full.";
    }

    var newMessageKey: string = generateUUID(); 

    // craft the new message to be inserted
    var newMessage: inboxMessage = {
        sender: context.currentEntity.Entity.Id, // ID of the player who called this function
        body: messageBody,
        sendDate: new Date(), // gets the current date & time
        messageId: newMessageKey,
    }

    targetInbox.messages.push(newMessage); // add the new message 

    // store the result
    storeInbox(targetInbox, targetEntityKey);

    return { Key: newMessageKey };
}
handlers["sendMessage"] = SendMessage;

interface ISendMessageResult {
    Key: string;
}

// Takes a string "messageToDelete" which is the identifier for the message to delete
var DeleteMessage = function (args: any, context: IPlayFabContext): IDeleteMessageResult {
    var numMessagesDeleted: number = 0;

    var currentPlayerEntity: PlayFabAuthenticationModels.EntityKey = context.currentEntity.Entity;
    var myInbox: playerInbox = GetInboxFromFile(currentPlayerEntity);

    let myMessages: inboxMessage[] = myInbox.messages;

    for (let i: number = 0; i < myMessages.length; i++){
        if (myMessages[i].messageId == args.messageToDelete) {
            numMessagesDeleted += myMessages.splice(i, 1).length;
        }
    }

    storeInbox(myInbox, currentPlayerEntity);

    log.debug("DeleteMessage(): Deleted " + numMessagesDeleted + " messages.");
    if (numMessagesDeleted > 1) {
        log.error("More than 1 message deleted");
    }

    return { numMessagesDeleted: numMessagesDeleted, newInboxSize: myMessages.length };
}
handlers["deleteMessage"] = DeleteMessage;

interface IDeleteMessageResult {
    numMessagesDeleted: number;
    newInboxSize: number;
}

// deletes the current user's entire inbox
var Truncate = function (args: any, context: IPlayFabContext) {
    storeInbox(new playerInbox(), context.currentEntity.Entity);
    log.debug("Truncate deleted the inbox for user " + context.currentEntity.Entity.Id);
}
handlers["truncate"] = Truncate;

var EasyLogEvent = function (args: IEasyLogEvent): void {
    log.info(JSON.stringify(args.logMessage));
};
interface IEasyLogEvent {
    logMessage: string
}
handlers["easyLogEvent"] = EasyLogEvent;



function getTitlePlayerEntityKey(masterPlayerID: string): PlayFabServerModels.EntityKey {

    log.debug("getTitlePlayerEntityKey called for ID:" + masterPlayerID);

    var accountInfoResponse: PlayFabServerModels.GetUserAccountInfoResult = server.GetUserAccountInfo({ PlayFabId: masterPlayerID });

    if (accountInfoResponse != null) {
        log.debug("accountInfoResponse TitlePlayerAccount: " + accountInfoResponse.UserInfo.TitleInfo.TitlePlayerAccount.Id + ", " + accountInfoResponse.UserInfo.TitleInfo.TitlePlayerAccount.Type);
        return accountInfoResponse.UserInfo.TitleInfo.TitlePlayerAccount;
    }

    //@todo: handle this error case
    log.debug("Maybe it's a title_player_account?");
    // I give up, hard code it and hope it's a title_player_account.
    return { Id: masterPlayerID, Type: "title_player_account" };
}
