/**
 * Registers platforms by hand in a running deployment's database, for an LMS without LTI Dynamic
 * Registration (Blackboard, Schoology): the same JSON as platforms.example.json - one platform or
 * a list - from a file or stdin.
 *
 *   node src/add-platform.js platform.json
 *   docker exec -i $(docker ps -qf name=fxlti_lti | head -1) node src/add-platform.js < platform.json
 *   node src/add-platform.js --remove <platform url> <client id>
 *
 * ltijs keeps every registration in MongoDB, so one run serves every replica and survives restarts;
 * platforms.json (platforms.js) is the same thing, read at each startup instead.
 */

var fs = require( 'fs' );
require( 'dotenv' ).config();
var { Provider } = require( 'ltijs' );

async function main() {
    var remove = process.argv[ 2 ] === '--remove';
    var list = remove ? [] : [].concat( JSON.parse( fs.readFileSync( process.argv[ 2 ] || 0, 'utf8' ) ) );

    var provider = new Provider( {
        logger: { debug: function () {}, warn: console.warn, error: console.error },
        database: { url: process.env.MONGO_URL },
        server: { port: 0 }
    } );
    // The database and cache only - no HTTP listener beside the running tool's.
    await provider.databaseManager.listen();
    await provider.cacheManager.listen();

    var failed = 0;
    if ( remove ) {
        var url = process.argv[ 3 ], clientId = process.argv[ 4 ];
        var platform = await provider.platformManager.getPlatform( url, clientId );
        if ( platform ) {
            await provider.platformManager.deletePlatform( platform );
            console.log( 'removed "' + platform.name + '" (' + url + ', client ' + clientId + ')' );
        } else {
            failed++;
            console.error( 'no platform ' + url + ' with client ' + clientId );
        }
    }
    for ( var i = 0; i < list.length; i++ ) {
        var p = list[ i ];
        try {
            await provider.platformManager.registerPlatform( p );
            console.log( 'registered "' + p.name + '" (' + p.url + ', client ' + p.clientId + ')' );
        } catch ( err ) {
            failed++;
            console.error( 'could not register "' + p.name + '": ' + ( err && err.name ) + ' ' + ( err && err.message ) );
        }
    }

    await provider.databaseManager.close();
    await provider.cacheManager.close();
    process.exit( failed ? 1 : 0 );
}

main().catch( function ( err ) {
    console.error( 'add-platform: ' + err.message );
    process.exit( 1 );
} );
