'use strict';
const Request = require('https').request;
const CLOUD_REQUEST = { 'user-agent': undefined };
const REQUEST_HEADERS = {
        headers: {
            'content-type':'application/json'
        },
        hostname: 'api.handsetdetection.com',
        method: 'POST',
        path: '/apiv4/device/detect.json'
    };
const CONFIG = {};
const FileSystem = require('fs');
const Unzip = require('unzip2').Extract;
const DATABASE_PATH_FOLDER = __dirname +'/ultimate4';
const DATABASE_PATH_ZIP = DATABASE_PATH_FOLDER + '.zip';
const REVERSE_TREE_TRAVERAL_ORDER = ['platform','browser','1','0'];
let LRU_CACHE = require('lru-cache')( 10e3 );
let LRU_GET = LRU_CACHE.get.bind( LRU_CACHE );
let LRU_SET = LRU_CACHE.set.bind( LRU_CACHE );
const EXTRAS_FILTER = new RegExp( ' |[^(\x20-\x7F)]*', 'g' );
const DEVICE_UA_FILTER = new RegExp( /_| |#|-|,|\.|\/|:|"|'/.source + '|[^(\x20-\x7F)]*', 'g' );
let DEVICE_ARRAY = [];
let EXTRAS_ARRAY = [];
let TREE = {};
let SAVE_TO_CACHE_ENABLED;
let EventEmitter;
///////////////////////////////////////////////////////////
////////// Main Module ///////////////////////////////////
///////////////////////////////////////////////////////
////////////////////////////////////////////////////////
///////////////////////////////////////////////////////
module.exports = {
    init: function( config ) {
        if ( config.username !== undefined && config.secret !== undefined ) {
            CONFIG.username = config.username;
            CONFIG.secret = config.secret;

            if ( config.cloud === true ) {
                setHTTPAuthHeader();
                return request;
            } else if ( config.enableAutoUpdates === true && config.eventEmitter !== undefined ) {
                EventEmitter = config.eventEmitter;
                return FileSystem.readdir( DATABASE_PATH_FOLDER, function( error ) {
                    // If the database is not downloaded, then download it
                    if ( error !== null && error.errno === -2 ) {
                        reportLog('HandSetDetection database not found. Downloading...');
                        updateDatabase();
                    }
                    // Every 3 days, update the database
                    setInterval( updateDatabase, 2.592e8 );
                });
            }
        } else if ( config.hosted === true ) {
            CONFIG.dir = DATABASE_PATH_FOLDER + '/';
            loadJSONfilesIntoMemory();
            return matchDevice;
        }
        console.error('ERROR from HandSetDetection client. Required params not met');
    },
    reloadLibrary: loadJSONfilesIntoMemory
};
////////// Cloud client ////////////////////////////////
function request( userAgent, callback ) {
    CLOUD_REQUEST['user-agent'] = userAgent;

    let streamWritable = Request( REQUEST_HEADERS, onResponse ).once('error', callback );
    streamWritable.callback = callback;
    streamWritable.end( JSON.stringify( CLOUD_REQUEST ) );
}
function onResponse( streamReadable ) {
    streamReadable.setEncoding('utf8').callback = this.callback;
    streamReadable.on('data', onChunk ).once('end', onDataEnd ).data = '';
}
function onChunk( chunk ) {
    this.data += chunk;
}
function onDataEnd() {
    this.callback( null, JSON.parse( this.data ) );
}
function setHTTPAuthHeader( updateDatabase ) {
    const md5 = ( string )=> require('crypto').createHash('md5').update( string ).digest('hex');
    const HA1 = md5( CONFIG.username + ':APIv4:' + CONFIG.secret );
    const HA2 = md5( updateDatabase === true? 'GET:/apiv4/device/fetcharchive.json' : 'POST:/apiv4/device/detect.json' );
    const cnonce = md5( Math.random().toString() );
    const response = md5( HA1 + ':APIv4:00000001:'+cnonce+':auth:' + HA2 );

    REQUEST_HEADERS.headers.authorization = 'Digest username="'+CONFIG.username+'", realm="APIv4", nonce="APIv4", uri="'+ (updateDatabase === true? '/apiv4/device/fetcharchive.json' : '/apiv4/device/detect.json' ) +'", cnonce="'+cnonce+'", nc=00000001, qop=auth, response="'+response+'", opaque="APIv4"';

    if ( updateDatabase === true ) {
        REQUEST_HEADERS.method = 'GET';
        REQUEST_HEADERS.path = '/apiv4/device/fetcharchive.json';
    } else {
        REQUEST_HEADERS.path = '/apiv4/device/detect.json';
        REQUEST_HEADERS.method = 'POST';
    }
}
////////// Cloud client - end ////////////////////////////////
///////// Hosted client - start ////////////////////////////
function loadJSONfilesIntoMemory() {
    let filesToLoad = REVERSE_TREE_TRAVERAL_ORDER.length;
    let updatedTree = {};
    let updatedDeviceArray = [];
    let updatedExtrasArray = [];

    FileSystem.readdir( CONFIG.dir, function( error, directory ) {
        if ( directory === undefined ) {
            TREE = {};
            DEVICE_ARRAY = [];
            EXTRAS_ARRAY = [];
            return;
        }
        const isJSONFile = / /.test.bind(/\.json/);
        const openAndReturnJSONFile = ( file )=> JSON.parse( FileSystem.readFileSync( CONFIG.dir + file, 'utf8' ) );
        const openJSONFileAsync = function( file ) {
            FileSystem.readFile( CONFIG.dir + file, 'utf8', function( error, jsonString ) {
                const json = JSON.parse( jsonString );
                let tree = {};

                for ( let filter in json ) {
                    let database = json[ filter ];

                    for ( let rootNode in database ) {
                        if ( tree[ rootNode ] === undefined ) {
                            tree[ rootNode ] = {};
                        }

                        let branch = database[ rootNode ];

                        for ( let leaf in branch ) {
                            if ( tree[ rootNode ][ leaf ] === undefined ) {
                                tree[ rootNode ][ leaf ] = branch[ leaf ];
                            }
                        }
                    }
                }

                updatedTree[ file.replace( replaceWithNothing, '' ) ] = tree;

                if ( --filesToLoad === 0 ) {
                    TREE = Object.assign( {}, updatedTree );
                    DEVICE_ARRAY = updatedDeviceArray.slice();
                    EXTRAS_ARRAY = updatedExtrasArray.slice();
                    SAVE_TO_CACHE_ENABLED = true;
                    LRU_CACHE.reset();
                    reportLog('Database loaded');
                }
            });
        };
        const replaceWithNothing = /user-agent|\.json/g;
        let i = directory.length;

        while ( i-- !== 0 ) {
            let file = directory[i];
            let splitFileName = file.split('_');

            if ( splitFileName[1] !== undefined ) {
                ( splitFileName[0] === 'Device'? updatedDeviceArray : updatedExtrasArray )[ +splitFileName[1].replace( replaceWithNothing, '' ) ] = openAndReturnJSONFile( file )[ splitFileName[0] ].hd_specs;
            } else if ( isJSONFile( file ) === true ) {
                switch ( file ) {
                    case 'user-agent0.json':
                    case 'user-agent1.json':
                    case 'user-agentbrowser.json':
                    case 'user-agentplatform.json':
                        openJSONFileAsync( file );
                }
            }
        }
    });
}
function matchDevice( userAgent ) {
    return LRU_GET( userAgent ) || traverseTree( userAgent );
}
function traverseTree( userAgent ) {
    const lowerCaseUserAgent = userAgent.toLowerCase();
    let normalizedUserAgent = lowerCaseUserAgent.replace( DEVICE_UA_FILTER , '' );
    let rootNode;
    let i = REVERSE_TREE_TRAVERAL_ORDER.length;
    let parsedUserAgent = {};

    while ( i-- !== 0 ) {
        let branch = TREE[ rootNode = REVERSE_TREE_TRAVERAL_ORDER[i] ];
        let indexFound = false;

        if ( rootNode === 'browser' ) {
            normalizedUserAgent = lowerCaseUserAgent.replace( EXTRAS_FILTER, '' );
        }
        for ( let node in branch ) {
            if ( normalizedUserAgent.indexOf( node ) !== -1 ) {
                let path = branch[ node ];
                for ( let leaf in path ) {
                    if ( normalizedUserAgent.indexOf( leaf ) !== -1 ) {
                        switch( rootNode ) {
                            case '0':
                                i--;
                            /* falls through */
                            case '1':
                                parsedUserAgent = DEVICE_ARRAY[ +path[ leaf ] ];
                                break;
                            case 'browser':
                            case 'platform':
                                let extraInfoOnUserAgent = EXTRAS_ARRAY[ +path[ leaf ] ];
                                for ( node in extraInfoOnUserAgent ) {
                                    if ( extraInfoOnUserAgent[ node ] !== '' ) {
                                        parsedUserAgent[ node ] = extraInfoOnUserAgent[ node ];
                                    }
                                }
                            break;
                        }
                        indexFound = true;
                        break;
                    }
                }
            }
            if ( indexFound === true ) {
                break;
            }
        }
    }
    process.nextTick( saveToCache, userAgent, parsedUserAgent );
    return parsedUserAgent;
}
function saveToCache( userAgent, parsedUserAgent ) {
    if ( SAVE_TO_CACHE_ENABLED === true ) {
        LRU_SET( userAgent, parsedUserAgent );
    }
}
function updateDatabase() {
    reportLog('Updating HandSetDetection database');
    setHTTPAuthHeader( true );
    Request( REQUEST_HEADERS, saveZipToFile ).once('error', reportError ).end();
    setHTTPAuthHeader();
    require('child_process').exec( 'rm -r ' + DATABASE_PATH_FOLDER );
}
function saveZipToFile( readableStream ) {
    readableStream.pipe( FileSystem.createWriteStream( DATABASE_PATH_ZIP ) ).once('finish', extractDatabaseZipFile ).once('error', reportError );
}
function extractDatabaseZipFile() {
    FileSystem.createReadStream( DATABASE_PATH_ZIP ).pipe( Unzip({ path: DATABASE_PATH_FOLDER }) ).once('error', reportError ).once('close', emitDoneDownloading );
}
function emitDoneDownloading() {
    reportLog('HandSetDetection database updated');
    EventEmitter.emit('HandSetDetection database updated');
    FileSystem.unlink( DATABASE_PATH_ZIP );
}
function reportLog( log ) {
    if ( log !== null ) {
        console.log('#LOG', new Date().toISOString(), Date.now(), log );
    }
}
function reportError( error ) {
    if ( error ) {
        console.error('#ERROR', new Date().toISOString(), Date.now(), error );
    }
}
///////// Hosted client - end ////////////////////////////
////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////