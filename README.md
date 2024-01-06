## anilist token
The anilist client works with a token you for access, this token is linked to your account!

You can request the token as follows:
1. visit https://anilist.co/settings/developer
2. click **Create New Client**
3. enter `https://anilist.co/api/v2/oauth/pin` as the *Redirect URL*
4. approve the generated token by visting `https://anilist.co/api/v2/oauth/authorize?client_id={clientID}&response_type=token` (**do not forget to rplace clientID in the URL!)
