const express = require('express')
const path = require('path')
const request = require('request')
const fs = require('fs')
const cors = require('cors')
const querystring = require('querystring')
const cookieParser = require('cookie-parser')
const dotenv = require('dotenv')
dotenv.config()

const port = process.env.PORT || 3000
const client_id = process.env.client_id
const client_secret = process.env.client_secret
const redirect_uri = `http://localhost:3000/callback`

/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
var generateRandomString = function(length) {
  var text = ''
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}

var stateKey = 'spotify_auth_state'

const app = express()

app.use(cors())
   .use(cookieParser())

app.get('/', function(req, res) {

  var state = generateRandomString(16)
  res.cookie(stateKey, state)

  // application requests authorization
  var scope = 'user-read-currently-playing user-follow-read playlist-modify-public'
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state
    }))
})

app.get('/callback', function(req, res) {

  // application requests refresh and access tokens
  // after checking the state parameter

  var code = req.query.code || null
  var state = req.query.state || null
  var storedState = req.cookies ? req.cookies[stateKey] : null

  if (state === null || state !== storedState) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }))
  } else {
    res.clearCookie(stateKey)
    var authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code'
      },
      headers: {
        'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
      },
      json: true
    }

    request.post(authOptions, function(error, response, body) {
      if (!error && response.statusCode === 200) {

        var access_token = body.access_token,
            refresh_token = body.refresh_token,
            playlistID
        
        // get user ID
        var userID,
            userOptions = {
              url: `https://api.spotify.com/v1/me`,
              headers: { 'Authorization': 'Bearer ' + access_token },
              json: true
            }

        request.get(userOptions, function(error, response, body) {
          userID = body.id
          // create a playlist to put the tracks in
          var date = new Date().toJSON().slice(0,10).replace(/-/g,'/')
          var playlistOptions = {
            name: `SpotShuffle ${date}`,
            public: true
          }
          request.post({url:`https://api.spotify.com/v1/users/${userID}/playlists`, body: playlistOptions, headers: { 'Authorization': 'Bearer ' + access_token, 'Content-Type': 'application/json'},
            json: true}, function optionalCallback(err, httpResponse, body) {
            if (err) {
              return console.error('upload failed:', err);
            } else console.log("Successfully created playlist")
            playlistID = body.id
          })
        })

        // get all artists followed by the user
        var artistOptions = {
          url: 'https://api.spotify.com/v1/me/following?type=artist',
          headers: { 'Authorization': 'Bearer ' + access_token },
          json: true
        }
        request.get(artistOptions, function(error, response, body) {
          var artists = body.artists.items

          // get all albums by each artist
          artists.forEach((artist,index,array) => {
            var artistID = artist.id
            var albumOptions = {
              url: `https://api.spotify.com/v1/artists/${artistID}/albums`,
              headers: { 'Authorization': 'Bearer ' + access_token },
              json: true
            }            
            request.get(albumOptions, function(error, response, body) {
              albums = body.items
              // get all tracks on each album
              albums.forEach(album => {
                var albumID = album.id
                var trackOptions = {
                  url: `https://api.spotify.com/v1/albums/${albumID}/tracks`,
                  headers: { 'Authorization': 'Bearer ' + access_token },
                  json: true
                }
                request.get(trackOptions, function(error, response, body) {
                  var tracks = body.items
                  var trackURIList = []
                  if (tracks !== undefined) {
                    tracks.forEach(track => {
                      trackURIList.push(track.uri)
                    })
                    request.post({url:`https://api.spotify.com/v1/playlists/${playlistID}/tracks`, body: {"uris": trackURIList}, headers: { 'Authorization': 'Bearer ' + access_token, 'Content-Type': 'application/json'},
                      json: true}, function optionalCallback(err, httpResponse, body) {
                      if (err) {
                        return console.error('upload failed:', err)
                      }
                    })
                  }
                })
              })
            })
          })
        })   

      } else {
        res.redirect('/#' +
          querystring.stringify({
            error: 'invalid_token'
          }))
      }
    })
  }
})

app.get('/refresh_token', function(req, res) {

  // requesting access token from refresh token
  var refresh_token = req.query.refresh_token
  var authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    headers: { 'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64')) },
    form: {
      grant_type: 'refresh_token',
      refresh_token: refresh_token
    },
    json: true
  }

  request.post(authOptions, function(error, response, body) {
    if (!error && response.statusCode === 200) {
      var access_token = body.access_token
      res.send({
        'access_token': access_token
      })
    }
  })
})

app.listen(port, () => console.log(`Server listening on port ${port}!`))