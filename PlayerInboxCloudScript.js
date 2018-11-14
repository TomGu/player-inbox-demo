var MAX_MESSAGES = 2400;
var MAX_MESSAGE_LENGTH = 1024;
var INBOX_FILENAME = "player_inbox.json";
var InboxMessage = /** @class */ (function () {
    function InboxMessage() {
    }
    return InboxMessage;
}());
var PlayerInbox = /** @class */ (function () {
    function PlayerInbox() {
        this.Messages = new Array(0);
    }
    return PlayerInbox;
}());
///
//  function ReceiveMessages 
//  Description: Gets messages from the current player's inbox and returns them to the client.
//  Parameters:
//      LastReceivedKey = Key of the last message the client has already received.  Function returns only messages
//                        which are newer than the specified message. If no key is passed, or the key passed is not found,
//                        function will start from the oldest message available.
//      Limit = Max number of messages to return.
///
var ReceiveMessages = function (args, context) {
    var lastMessageKey = args.LastReceivedKey;
    var returnLimit = args.Limit;
    if (returnLimit == null) {
        log.error("Limit missing");
        throw "Limit missing";
    }
    if (returnLimit > 1000 || returnLimit <= 0) {
        log.error("Limit of " + returnLimit + " was outside of allowed range (must be between 1 and 1000)");
        throw "Limit of " + returnLimit + " was outside of allowed range (must be between 1 and 1000)";
    }
    // read contents of current player's inbox from file
    var myInbox = GetInboxFromFile(context.currentEntity.Entity);
    var startIndex = 0; // Index of first (oldest) message to return
    var endIndex = myInbox.Messages.length; // Index of last (newest) message to return
    if (lastMessageKey != null && lastMessageKey != "") { // if a Key was passed
        log.debug("Getting messages newer than " + lastMessageKey);
        for (var i = 0; i < myInbox.Messages.length; i++) {
            if (lastMessageKey == myInbox.Messages[i].Key) {
                startIndex = i + 1;
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
    var remainingMessages = myInbox.Messages.length - endIndex;
    log.debug("GetMessages is returning a range of messages from " +
        startIndex + " to " + endIndex +
        ".\n Total inbox size was " + myInbox.Messages.length +
        ".\n More messages to get = " + remainingMessages +
        ".\n Last message key was [" + lastMessageKey + "]");
    myInbox.Messages = myInbox.Messages.slice(startIndex, endIndex);
    return { Count: remainingMessages, Messages: myInbox.Messages };
};
handlers["ReceiveMessages"] = ReceiveMessages;
///
//  function SendMessage
//  Description: Sends a single message to the specified title_player_account  
//  Parameters:
//      Destination = PlayFab title_player_account id of the player to whom this message should be sent
//      Message = Body of the message to send  
///
var SendMessage = function (args, context) {
    var messageBody = args.Message;
    var messageRecipientId = args.Destination;
    if (messageBody.length > MAX_MESSAGE_LENGTH) {
        log.error("Message body of length " + messageBody.length + " exceeded maximum allowed size of " + MAX_MESSAGE_LENGTH);
        throw "Message body of length " + messageBody.length + " exceeded maximum allowed size of " + MAX_MESSAGE_LENGTH;
    }
    if (messageRecipientId == null || 0 == +messageRecipientId) {
        log.error("Missing message destination");
        throw "Missing message destination";
    }
    var targetEntityKey = getTitlePlayerEntityKeyFromTitlePlayerID(messageRecipientId);
    // get contents of the recipient's inbox
    var targetInbox = GetInboxFromFile(targetEntityKey);
    // check if the inbox is already full
    if (targetInbox.Messages.length >= MAX_MESSAGES) {
        log.error("Player Inbox Full");
        throw "Unable to send: player inbox is full";
    }
    var newMessageKey = generateUUID();
    // craft the new message to be inserted
    var newMessage = {
        Sender: context.currentEntity.Entity.Id,
        Message: messageBody,
        Created: new Date(),
        Key: newMessageKey,
    };
    targetInbox.Messages.push(newMessage); // add the new message 
    // store the result
    storeInbox(targetInbox, targetEntityKey);
    return { Key: newMessageKey };
};
handlers["SendMessage"] = SendMessage;
///
//  function DeleteMessage
//  Description: Deletes the oldest message with the specified Key in the current player's inbox.  
//               Note that there should only be at most 1 matching message.
//  Parameters:
//      Key = Identifier of the message to delete
///
var DeleteMessage = function (args, context) {
    var messageToDeleteKey = args.Key;
    if (messageToDeleteKey == null) {
        log.error("DeleteMessage: No message key passed");
        throw "Missing message key";
    }
    var currentPlayerEntity = context.currentEntity.Entity;
    var myInbox = GetInboxFromFile(currentPlayerEntity);
    var deleteCount = 0; // track number of messages deleted
    for (var i = 0; i < myInbox.Messages.length; i++) {
        if (myInbox.Messages[i].Key == messageToDeleteKey) {
            myInbox.Messages.splice(i, 1);
            deleteCount++;
            break;
        }
    }
    if (deleteCount > 0) {
        storeInbox(myInbox, currentPlayerEntity);
    }
    else {
        log.error("DeleteMessage: Message with key " + messageToDeleteKey + " not found");
    }
    return { Key: messageToDeleteKey };
};
handlers["DeleteMessage"] = DeleteMessage;
// Deletes the specified user's entire inbox for demo/testing purposes.
var Truncate = function (args, context) {
    // @todo: Before shipping, remove this or add a check to ensure 
    // only the right administrators or services can call this function
    var targetPlayerID = args.UserId;
    storeInbox(new PlayerInbox(), getTitlePlayerEntityKeyFromTitlePlayerID(targetPlayerID));
};
handlers["TruncateInbox"] = Truncate;
// Internal helper function to get a player inbox from the entity file where it is stored
function GetInboxFromFile(targetEntity) {
    var targetInbox = new PlayerInbox();
    var getFilesResult = entity.GetFiles({ Entity: targetEntity });
    if (getFilesResult.Metadata[INBOX_FILENAME] == null) {
        log.debug("Player does not have an inbox file, returning a new inbox.");
        targetInbox.ProfileVersion = getFilesResult.ProfileVersion;
        return targetInbox;
    }
    var fileURL = getFilesResult.Metadata[INBOX_FILENAME].DownloadUrl;
    var response = http.request(fileURL, "GET", "", 'application/json', {});
    if (response != null) {
        targetInbox = JSON.parse(response.toString());
    }
    if (targetInbox == null || targetInbox.Messages == null) {
        targetInbox = new PlayerInbox();
    }
    //Track which ProfileVersion this came from to avoid stomping on conflicting updates later
    targetInbox.ProfileVersion = getFilesResult.ProfileVersion;
    return targetInbox;
}
// Helper function to create UUIDs for messages.  
// based on this post: https://stackoverflow.com/questions/105034/create-guid-uuid-in-javascript
function generateUUID() {
    var d = new Date().getTime();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (d + Math.random() * 16) % 16 | 0;
        d = Math.floor(d / 16);
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}
// Internal function used to store player inbox object to a file for the specified target player entity.
// Note that no exception handling happens in here, we will catch exceptions in the functions which call this one.
function storeInbox(inboxToStore, targetEntity) {
    var initFileUploadRequest = {
        Entity: targetEntity,
        ProfileVersion: inboxToStore.ProfileVersion,
        FileNames: [INBOX_FILENAME]
    };
    var initResponse = entity.InitiateFileUploads(initFileUploadRequest);
    var putResponse = http.request(initResponse.UploadDetails[0].UploadUrl, "PUT", JSON.stringify(inboxToStore), 'application/json', {});
    var finalFileUploadRequest = {
        Entity: targetEntity,
        FileNames: [INBOX_FILENAME]
    };
    var finalResponse = entity.FinalizeFileUploads(finalFileUploadRequest);
}
// Helper function to turn a title player ID into an entity key
function getTitlePlayerEntityKeyFromTitlePlayerID(titlePlayerID) {
    return { Id: titlePlayerID, Type: "title_player_account" };
}
//# sourceMappingURL=PlayerInboxCloudScript.js.map