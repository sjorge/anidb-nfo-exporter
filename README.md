## anidb nfo expoter
This is a helper to export tvshow.nfo and episode.nfo files to help jellyfin match anime when using `adbren` to name your anime.

This works best when configuring the jellyfin anidb plugin as the primary source, you can also configure the anilist plugin with lower priority.
The anilist Id gets added to the NFO if it was possible to map it which is not always the case. Configuring an anilist token can improve the chances of
mapping an anilist id.

## configuration
### anidb client
You need to register a client with anidb and configure it.

1. visit https://anidb.net/software/add
2. click **Add New Project**
3. fill in the info requested
5. add a new version (proto=HTTP)

### anilist token
The anilist client works with a token you for access, this token is linked to your account!

You can request the token as follows:
1. visit https://anilist.co/settings/developer
2. click **Create New Client**
3. enter `https://anilist.co/api/v2/oauth/pin` as the *Redirect URL*
4. approve the generated token by visting `https://anilist.co/api/v2/oauth/authorize?client_id={clientID}&response_type=token` (**do not forget to rplace clientID in the URL!)
