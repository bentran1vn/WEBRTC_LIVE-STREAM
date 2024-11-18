using Microsoft.AspNetCore.SignalR;

namespace TestLiveStream.API;

public class LivestreamHub : Hub
{
    // Viewer or Host joins the room
    public async Task JoinRoom(string roomId, bool isHost)
    {
        if (string.IsNullOrWhiteSpace(roomId))
        {
            throw new ArgumentException("Room ID cannot be null or empty.");
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);

        if (isHost)
        {
            await Clients.Group(roomId).SendAsync("HostJoined", "Host has joined and started streaming");
        }
        else
        {
            await Clients.Caller.SendAsync("ConnectionStatus", "Joined livestream - waiting for host stream");
        }

        await Clients.Group(roomId).SendAsync("UserJoined", Context.ConnectionId);
    }

    // Notify viewers that the host started streaming
    public async Task StartStreaming(string roomId)
    {
        await Clients.Group(roomId).SendAsync("HostStartedStreaming", "Host has started streaming");
    }

    // Remove user from room
    public async Task LeaveRoom(string roomId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("UserLeft", Context.ConnectionId);
    }

    // Send WebRTC signaling message
    public async Task SendMessage(string roomId, string message)
    {
        await Clients.Group(roomId).SendAsync("ReceiveMessage", message);
    }
}