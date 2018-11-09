
const MAX_MESSAGES: number = 2400;
const INBOX_FILENAME: string = "player_inbox.json";

class inboxMessage {
    Key: string;
    Sender: string;
    Message: string;
    Created: Date;
}

class playerInbox {
    Messages: inboxMessage[]; // array of messages in this inbox
    ProfileVersion: number; // version of the profile this inbox came from (to protect against merge concurrent write issues)
    constructor() { this.Messages = new Array<inboxMessage>(0) } 
}

///
//  function ReceiveMessages 
//  Description: Gets messages from the current player's inbox and returns them to the client.  
//  Parameters:
//      LastReceivedKey = Key of the last message the client has already received.  Function returns only messages
//                        which are newer than the specified message. If no key is passed, or the key passed is not found,
//                        function will start from the oldest message available.
//      Limit = Max number of messages to return.  
///
var ReceiveMessages = function (args: any, context: IPlayFabContext): IReceiveMessageResult {
    var lastMessageKey: string = args.LastReceivedKey;
    var returnLimit: number = args.Limit;

    if (returnLimit != null && (returnLimit > 1000 || returnLimit <= 0)) {
        throw "Limit of " + returnLimit + " was outside of allowed range (must be between 1 and 1000)"
    }

    // read contents of current player's inbox from file
    var myInbox: playerInbox = GetInboxFromFile(context.currentEntity.Entity);

    var startIndex: number = 0; // Index of first (oldest) message to return
    var endIndex: number = myInbox.Messages.length; // Index of last (newest) message to return


    if (lastMessageKey != null && lastMessageKey != "") { // if a key was passed
    
        var lastMessageKey: string = args.LastReceivedKey;
        log.debug("Getting messages newer than " + lastMessageKey);

        for (var i: number = 0; i < myInbox.Messages.length; i++) {
            if (lastMessageKey == myInbox.Messages[i].Key) {
                startIndex = i+1;
                log.debug("Found message at index " + i);
                break;
            }
        }
    }

    if (returnLimit != null) {
        endIndex = Math.min(endIndex, startIndex + returnLimit);
    }

    // remainingMessages captures the number of messages newer than the ones being 
    // returned to indicate how many more messages the client should be expecting 
    // to receive in subsequent calls
    var remainingMessages: number = myInbox.Messages.length - endIndex;

    log.debug(
        "GetMessages is returning a range of messages from " +
        startIndex + " to " + endIndex +
        ".\n Total inbox size was " + myInbox.Messages.length +
        ".\n More messages to get = " + remainingMessages +
        ".\n Last message key was [" + lastMessageKey + "]"
    );

    myInbox.Messages = myInbox.Messages.slice(startIndex, endIndex); 

    return {Count: remainingMessages, Messages: myInbox.Messages};
}
handlers["ReceiveMessages"] = ReceiveMessages;

interface IReceiveMessageResult {
    Count: number;
    Messages: inboxMessage[];
}


///
//  function SendMessage
//  Description: Gets messages from the current player's inbox and returns them to the client.  
//  Parameters:
//      Destination = PlayFab title_player_id of the player to whom this message should be sent
//      Message = Body of the message to send  
///
var SendMessage = function (args: any, context: IPlayFabContext): ISendMessageResult {

    var messageBody: string = args.Message;
    var messageRecipientId: string = args.Destination;

    if (messageBody.length > 1000) { //@todo: need to verify that message size < 1KB
        log.error("Message body too large: " + messageBody.length );
        throw "Message exceeded maximum allowed size";
    }

    if (messageRecipientId == null || 0 == +messageRecipientId) {
        log.error("Invalid message recipient passed: " + messageRecipientId);
        throw "Missing message destination";
    }

    var targetEntityKey: PlayFabAuthenticationModels.EntityKey = getTitlePlayerEntityKeyFromTitlePlayerID(messageRecipientId);

    // get contents of the recipient's inbox
    var targetInbox: playerInbox = GetInboxFromFile(targetEntityKey);

    // check if the inbox is already full
    if (targetInbox.Messages.length >= MAX_MESSAGES) {
        log.error("Player Inbox Full");
        throw "Error: Player inbox is full";
    }

    var newMessageKey: string = generateUUID(); 

    // craft the new message to be inserted
    var newMessage: inboxMessage = {
        Sender: context.currentEntity.Entity.Id, // ID of the player who called this function
        Message: messageBody,
        Created: new Date(), // current date & time
        Key: newMessageKey,
    }

    targetInbox.Messages.push(newMessage); // add the new message 

    // store the result
    try {
        storeInbox(targetInbox, targetEntityKey);
    } catch (err) {
        throw "Unable to send message.  Please try again later."
    }

    return { Key: newMessageKey };
}
handlers["SendMessage"] = SendMessage;

interface ISendMessageResult {
    Key: string;
}

///
//  function DeleteMessage
//  Description: Deletes the oldest message with the specified Key in the current player's inbox.  
//               Note that there should only be at most 1 matching message.
//  Parameters:
//      Key = Identifier of the message to delete
///
var DeleteMessage = function (args: any, context: IPlayFabContext): IDeleteMessageResult {

    var messageToDeleteKey: string = args.Key;

    if (messageToDeleteKey == null ) {
        log.error("DeleteMessage: No message key passed");
        throw "Missing message key";
    }

    var currentPlayerEntity: PlayFabAuthenticationModels.EntityKey = context.currentEntity.Entity;
    var myInbox: playerInbox = GetInboxFromFile(currentPlayerEntity);
    var deleteCount: number = 0; // track number of messages deleted

    for (let i: number = 0; i < myInbox.Messages.length; i++){
        if (myInbox.Messages[i].Key == messageToDeleteKey) {
            myInbox.Messages.splice(i, 1);
            deleteCount++;
            break; // remove this if you want to delete all messages with the specified key
        }
    }

    if (deleteCount > 0) {
        try {
            storeInbox(myInbox, currentPlayerEntity);
        } catch (err) {
            throw "Unable to delete message.  Please try again later."
        }
    }
    else {
        log.error("DeleteMessage: Message with key " + messageToDeleteKey + " not found" );
    }

    return { Key: messageToDeleteKey };
}
handlers["DeleteMessage"] = DeleteMessage;

interface IDeleteMessageResult {
    Key: string;
}

// Deletes the specified user's entire inbox for demo/testing purposes.
var Truncate = function (args: any, context: IPlayFabContext) {
    // @todo: Before shipping, remove this or add a check to ensure 
    // only the right administrators or services can call this function
    var targetPlayerID: string = args.UserId;
    try {
        storeInbox(new playerInbox(), getTitlePlayerEntityKeyFromTitlePlayerID(targetPlayerID));
    } catch (err) {
        throw "Clearing Inbox failed.  Please try again later."
    }
}
handlers["TruncateInbox"] = Truncate;

// Internal helper function to get a player inbox from the entiy file where it is stored
function GetInboxFromFile(targetEntity: PlayFabAuthenticationModels.EntityKey): playerInbox {
    //log.debug("GetMessagesFromFile called for entity: " + targetEntity.Id + " " + targetEntity.Type);

    var targetInbox: playerInbox = new playerInbox();
    var getFilesResult: PlayFabDataModels.GetFilesResponse = entity.GetFiles({ Entity: targetEntity });

    if (getFilesResult.Metadata[INBOX_FILENAME] == null) {
        log.debug("Player does not have an inbox file, returning a new inbox.")
        targetInbox.ProfileVersion = getFilesResult.ProfileVersion;
        return targetInbox;
    }
    
    var fileURL: string = getFilesResult.Metadata[INBOX_FILENAME].DownloadUrl;
    var response = http.request(fileURL, "GET", "", 'application/json', {});

    if (response != null) {
        targetInbox = JSON.parse(response.toString());
    }

    if (targetInbox == null || targetInbox.Messages == null) {
        targetInbox = new playerInbox();
    }

    //Track which ProfileVersion this came from to avoid stomping on conflicting updates later
    targetInbox.ProfileVersion = getFilesResult.ProfileVersion; 

    return targetInbox;
}


// Helper function to create UUIDs for messages.  
// based on this post: https://stackoverflow.com/questions/105034/create-guid-uuid-in-javascript
function generateUUID(): string { // Public Domain/MIT 
    var d = new Date().getTime();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (d + Math.random() * 16) % 16 | 0;
        d = Math.floor(d / 16);
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// Internal function used to store player inbox object to a file for the specified target player entity.
// Note that no exception handling happens in here, we will catch exceptions in the functions which call this one.
function storeInbox(inboxToStore: playerInbox, targetEntity: PlayFabAuthenticationModels.EntityKey) {

    var initFileUploadRequest: PlayFabDataModels.InitiateFileUploadsRequest = {
        Entity: targetEntity,
        ProfileVersion: inboxToStore.ProfileVersion,
        FileNames: [INBOX_FILENAME]
    };

    //log.debug("Init File Upload FileNames: " + initFileUploadRequest.FileNames);

    var initResponse: PlayFabDataModels.InitiateFileUploadsResponse = entity.InitiateFileUploads(initFileUploadRequest);
    //log.debug("Init File Upload response: " + JSON.stringify(initResponse.UploadDetails));
    //log.debug("Upload URL: " + initResponse.UploadDetails[0].UploadUrl);
    
    var putResponse = http.request(initResponse.UploadDetails[0].UploadUrl, "PUT", JSON.stringify(inboxToStore), 'application/json', {});
    //log.debug("http put response: " + putResponse);
    
    var finalFileUploadRequest: PlayFabDataModels.FinalizeFileUploadsRequest = {
        Entity: targetEntity,
        FileNames: [INBOX_FILENAME]
    };

    var finalResponse: PlayFabDataModels.FinalizeFileUploadsResponse = entity.FinalizeFileUploads(finalFileUploadRequest);
}

// Translates a master player account ID into a title player account Entity Key
function getTitlePlayerEntityKeyFromMasterPlayerID(masterPlayerID: string): PlayFabServerModels.EntityKey {

    var accountInfoResponse: PlayFabServerModels.GetUserAccountInfoResult = server.GetUserAccountInfo({ PlayFabId: masterPlayerID });

    if (accountInfoResponse == null) {
        throw "Failed to get User Account Info for " + masterPlayerID;
    }

    return accountInfoResponse.UserInfo.TitleInfo.TitlePlayerAccount;
}

// Helper function to turn a title player ID into an entity key
function getTitlePlayerEntityKeyFromTitlePlayerID(titlePlayerID: string): PlayFabServerModels.EntityKey {
    return { Id: titlePlayerID, Type: "title_player_account" };
}
