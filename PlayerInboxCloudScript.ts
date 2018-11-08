
const MAX_MESSAGES: number = 2400;
const INBOX_FILENAME: string = "player_inbox.json";

 
class inboxMessage {
    sender: string;
    body: string;
    sendDate: Date;
    messageId: string;
}

class playerInbox {
    messages: inboxMessage[];
    constructor() { this.messages = new Array<inboxMessage>(0) } 
}

var GetInboxFromFile = function (targetEntity: PlayFabAuthenticationModels.EntityKey): playerInbox {
    //log.debug("GetMessagesFromFile called for entity: " + targetEntity.Id + " " + targetEntity.Type);

    var targetInbox: playerInbox = new playerInbox();
    var getFilesResult: PlayFabDataModels.GetFilesResponse = entity.GetFiles({ Entity: targetEntity });
    
    //log.debug("Got file list for Entity " + getFilesResult.Entity.Id);

    if (getFilesResult.Metadata[INBOX_FILENAME] == null) {
        log.debug("Player does not have an inbox file, returning a new inbox.")
        return targetInbox;
    }
    
    var fileURL: string = getFilesResult.Metadata[INBOX_FILENAME].DownloadUrl;
    var response = http.request(fileURL, "GET", "", 'application/json', {});
   
    if (response != null) {
        targetInbox = JSON.parse(response.toString()); //@todo: deal with parsing errors
    }

    if (targetInbox == null) {
        targetInbox = new playerInbox();
    }

    return targetInbox;
}


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

    var initFileUploadRequest: PlayFabDataModels.InitiateFileUploadsRequest = {
        Entity: targetEntity,
        FileNames: [INBOX_FILENAME]
    };

    log.debug("Init File Upload FileNames: " + initFileUploadRequest.FileNames);
    
    //initFileUploadRequest.ProfileVersion = oldVersion;//@todo - may want to do something with this - race condition here
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

}

// based on this post: https://stackoverflow.com/questions/105034/create-guid-uuid-in-javascript
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
        throw "Message exceeded maximum allowed size";
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
    // @todo: add a check to ensure only administrators/services can call this function
    // @todo: change this to take an ID of the account to truncate

    storeInbox(new playerInbox(), context.currentEntity.Entity);
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

    var accountInfoResponse: PlayFabServerModels.GetUserAccountInfoResult = server.GetUserAccountInfo({ PlayFabId: masterPlayerID });

    if (accountInfoResponse == null) {
        throw "Failed to get User Account Info for " + masterPlayerID;
    }

    return accountInfoResponse.UserInfo.TitleInfo.TitlePlayerAccount;
}
