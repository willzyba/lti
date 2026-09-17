/**
 * Registers every LTI 1.3 platform this deployment trusts, from a JSON config - one file (or
 * the PLATFORMS_JSON env var holding the same content, for a deployment that would rather
 * keep it in a secret manager than a file on disk) covering Canvas, Blackboard, Brightspace,
 * Schoology and any other LTI 1.3 Advantage platform, since registration is the same shape
 * for all of them. See platforms.example.json for the format (matching ltijs' own
 * PlatformRegistrationInput type), and the README for where each platform's own values come
 * from - they differ per institution, not just per LMS vendor.
 */

var fs = require( 'fs' );
var path = require( 'path' );

function loadPlatformConfigs() {
    if ( process.env.PLATFORMS_JSON ) {
        return JSON.parse( process.env.PLATFORMS_JSON );
    }

    var file = process.env.PLATFORMS_FILE || path.join( __dirname, '..', 'platforms.json' );
    if ( !fs.existsSync( file ) ) {
        console.warn(
            'eqneditor-lti: no ' + file + ' and no PLATFORMS_JSON env var - ' +
            'no LTI platforms registered. Copy platforms.example.json to platforms.json and ' +
            'fill in each platform you want to support.'
        );
        return [];
    }

    return JSON.parse( fs.readFileSync( file, 'utf8' ) );
}

/**
 * @param {import('ltijs').Provider} provider
 */
async function registerPlatforms( provider ) {
    var configs = loadPlatformConfigs();

    for ( var i = 0; i < configs.length; i++ ) {
        var p = configs[ i ];
        try {
            await provider.platformManager.registerPlatform( p );
            console.log( 'eqneditor-lti: registered platform "' + p.name + '" (' + p.url + ')' );
        } catch ( err ) {
            // PlatformAlreadyRegisteredError on every run after the first - this function is
            // called on every startup, and re-registering an unchanged platform is not an
            // error worth alarming anyone over.
            if ( err && err.name === 'PlatformAlreadyRegisteredError' ) {
                console.log( 'eqneditor-lti: platform "' + p.name + '" already registered.' );
                continue;
            }
            console.error( 'eqneditor-lti: could not register platform "' + p.name + '": ' + err.message );
        }
    }
}

module.exports = { registerPlatforms: registerPlatforms, loadPlatformConfigs: loadPlatformConfigs };
