/**
 * fxEditor as a single LTI 1.3 Advantage tool.
 *
 * One deployment of this server reaches Canvas, Blackboard, Brightspace, Schoology, Moodle and any
 * other LTI 1.3 platform - instead of a separate native plugin per LMS, which is what the other
 * adapters in this repo are. Built on ltijs (https://github.com/Cvmcosta/ltijs) v7, an
 * actively-maintained open-source LTI 1.3 Advantage implementation, rather than hand-rolled
 * OIDC/JWT handling - this is an auth flow, and that is not a place to prefer bespoke code over a
 * maintained library. v7 is a full TypeScript rewrite of the older, much more widely-documented v5
 * API; where a comment explains a choice, it is usually because v7 changed something v5 tutorials
 * still describe differently. Every ltijs call here was checked against the installed package's
 * own .d.ts files.
 *
 * Platforms get here two ways:
 *
 *   - Dynamic Registration (registration.js): the LMS administrator pastes /register into the LMS
 *     and the two exchange everything themselves - Moodle, Canvas, Brightspace.
 *   - Manual registration (platforms.js): the LMS's values copied into platforms.json - Blackboard,
 *     Schoology, or any LMS without Dynamic Registration.
 *
 * Two launch shapes, both served the same editor page (views/launch.html):
 *
 *   - Deep Linking: the instructor opened the tool from a content picker or an editor button to
 *     put an equation into a page. Insert posts to /insert, which answers with an auto-submitting
 *     form carrying a Deep Linking response - the LMS embeds the equation (content.js).
 *   - Resource Link: the tool was opened from a link. A link this tool made (Moodle's "Select
 *     content") carries its equation in custom parameters and shows it; any other shows the editor,
 *     whose Insert then gives the image to copy.
 *
 * Every launch is recorded against its deployment, with its licence (deployments.js). With
 * LICENCE_MODE=enforce, a deployment fxtex does not know as licensed is shown how to become so
 * instead of the editor; otherwise (the default, "log") it is only recorded.
 *
 * Requires MongoDB (ltijs' store, and the deployment records) - see .env.example. Unlike v5, v7
 * needs no encryption key: each platform gets its own RSA keypair, generated at registration and
 * stored in Mongo. Launch tokens (id_tokens) are kept 24 hours, by a TTL index ltijs creates.
 */

require( 'dotenv' ).config();

var fs = require( 'fs' );
var path = require( 'path' );
var { Provider, HttpMethod, LtiMessageType } = require( 'ltijs' );
var platforms = require( './platforms' );
var registration = require( './registration' );
var deployments = require( './deployments' );
var content = require( './content' );

if ( !process.env.MONGO_URL ) {
    console.error( 'fxeditor-lti: MONGO_URL is not set - see .env.example.' );
    process.exit( 1 );
}

var PORT = process.env.PORT ? Number( process.env.PORT ) : 3000;
// This tool's own public address - what LMSs are given to launch it at.
var TOOL_URL = ( process.env.TOOL_URL || 'http://localhost:' + PORT ).replace( /\/+$/, '' );
var EQNEDITOR_SERVER = process.env.EQNEDITOR_SERVER || 'https://fxtex.codecogs.com';
var RENDER_URL = process.env.EQNEDITOR_RENDER_URL || 'https://fxtex.codecogs.com';
var LICENCE_MODE = process.env.LICENCE_MODE === 'enforce' ? 'enforce' : 'log';
// The fxTeX Pro licence for the tool's own pages: EQNEDITOR_LICENCE, or the file EQNEDITOR_LICENCE_FILE
// names - which is how a Docker secret arrives (docker-swarm/docker-fxlti.yml), so the key itself
// never appears in a file that is committed.
var LICENCE = process.env.EQNEDITOR_LICENCE || '';
if ( !LICENCE && process.env.EQNEDITOR_LICENCE_FILE ) {
    try {
        LICENCE = fs.readFileSync( process.env.EQNEDITOR_LICENCE_FILE, 'utf8' ).trim();
    } catch ( err ) {
        console.error( 'fxeditor-lti: cannot read EQNEDITOR_LICENCE_FILE: ' + err.message );
    }
}
// Where licences are checked: fxtex's /diagnostics.json.
var FXTEX_ORIGIN = ( process.env.FXTEX_ORIGIN || 'https://fxtex.codecogs.com' ).replace( /\/+$/, '' );

// ltijs' own logger writes through the `debug` package, so without DEBUG set it says nothing -
// failed launches included. Warnings and errors always reach the log here; debug lines only with
// DEBUG set (any value).
var logger = {
    debug: function ( component, message ) {
        if ( process.env.DEBUG ) console.log( 'ltijs ' + component + ': ' + message );
    },
    warn: function ( component, message ) { console.warn( 'ltijs ' + component + ': ' + message ); },
    error: function ( component, message ) { console.error( 'ltijs ' + component + ': ' + message ); }
};

var provider = new Provider( {
    logger: logger,
    database: { url: process.env.MONGO_URL },
    server: { port: PORT },
    routes: {
        loginRoute: '/login',
        launchRoute: '/launch',
        keysetRoute: '/keys',
        dynamicRegistrationRoute: '/register'
    },
    dynamicRegistration: registration.options( TOOL_URL )
} );
registration.install( provider, TOOL_URL );

// ltijs keeps each launch's id_token for 24 hours, so /config and /insert can resume the launch -
// every claim in it, as the platform sent it. Registration asks platforms for no personal data
// (registration.js), but a platform registered by hand may send it anyway, so it is dropped here,
// before anything is stored: nothing this tool does needs to know who someone is.
var PERSONAL_CLAIMS = [ 'name', 'given_name', 'family_name', 'middle_name', 'nickname', 'preferred_username',
    'email', 'email_verified', 'picture', 'profile', 'locale', 'phone_number', 'address',
    'https://purl.imsglobal.org/spec/lti/claim/lis',
    // Vendor extras - Moodle puts the username here when it is allowed to send names.
    'https://purl.imsglobal.org/spec/lti/claim/ext' ];
var CONTEXT_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/context';
var saveIdToken = provider.databaseManager.saveIdToken.bind( provider.databaseManager );
provider.databaseManager.saveIdToken = function ( token ) {
    var kept = Object.assign( {}, token );
    PERSONAL_CLAIMS.forEach( function ( claim ) { delete kept[ claim ]; } );
    // The course: its opaque id and type are kept, its title and code are not needed.
    if ( kept[ CONTEXT_CLAIM ] ) {
        kept[ CONTEXT_CLAIM ] = { id: kept[ CONTEXT_CLAIM ].id, type: kept[ CONTEXT_CLAIM ].type };
    }
    return saveIdToken( kept );
};

// Behind fxnginx, which terminates TLS: believe its X-Forwarded-* about the original request.
provider.httpHandler.app.set( 'trust proxy', true );

var VIEWS = path.join( __dirname, '..', 'views' );
var launchTemplate = fs.readFileSync( path.join( VIEWS, 'launch.html' ), 'utf8' );
// The fxEditor icon, which LMSs show in their tool lists (/logo.png), and the small fx mark for an
// editor's toolbar button (/logo.svg), as every other fxEditor plugin's button has.
var logo = fs.readFileSync( path.join( VIEWS, 'logo.png' ) );
var buttonIcon = fs.readFileSync( path.join( VIEWS, 'logo.svg' ) );

// Both are shown on the LMS's own pages, so must be embeddable from any origin - the helmet
// defaults ltijs applies say same-origin only.
var IMAGE_HEADERS = { 'Cache-Control': 'public, max-age=86400', 'Cross-Origin-Resource-Policy': 'cross-origin' };
provider.httpHandler.app.get( '/logo.png', function ( request, response ) {
    response.type( 'image/png' ).set( IMAGE_HEADERS ).send( logo );
} );
provider.httpHandler.app.get( '/logo.svg', function ( request, response ) {
    response.type( 'image/svg+xml' ).set( IMAGE_HEADERS ).send( buttonIcon );
} );
provider.httpHandler.app.get( '/health', function ( request, response ) {
    response.type( 'text/plain' ).send( 'ok' );
} );

var escapeHtml = content.escapeHtml;

// EQNEDITOR_DESIGN is JSON; anything that does not parse is treated as no design at all, so a
// typo leaves the standard editor rather than a broken one.
function parseDesign( json ) {
    try {
        return JSON.parse( json || '{}' ) || {};
    } catch ( e ) {
        return {};
    }
}

function page( title, body ) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>' + escapeHtml( title ) + '</title><style>body{font-family:-apple-system,"Segoe UI",Arial,sans-serif;margin:0;padding:20px;' +
        'max-width:720px;color:#1c2530;line-height:1.5}h1{font-size:18px;margin:0 0 8px}img.fxeditor-equation{max-width:100%}' +
        'code{word-break:break-all}</style></head><body>' + body + '</body></html>';
}

function renderLaunchPage( ltik ) {
    // The one thing the static template needs from the server: the ltik that identifies this
    // launch, so the client's later /config and /insert calls can resume it via
    // Provider.getLaunchContext(). JSON.stringify both quotes it and escapes anything that
    // would otherwise break out of the string literal.
    return launchTemplate.replace( '"__LTIK__"', JSON.stringify( ltik ) );
}

function unlicensedPage( deployment ) {
    return page( 'fxEditor is not licensed here',
        '<h1>fxEditor is not licensed for ' + escapeHtml( deployment.host || 'this site' ) + '</h1>' +
        '<p>Your institution has added fxEditor to its learning platform, but has no fxEditor licence for it yet.</p>' +
        '<p>Please ask your LMS administrator. They can buy a licence at <a href="https://fxeditor.codecogs.com/purchase" target="_blank">fxeditor.codecogs.com/purchase</a>, ' +
        'then either add <code>' + escapeHtml( deployment.host || 'the LMS address' ) + '</code> as a domain on the licence, ' +
        'or put the licence key into the fxEditor tool\'s custom parameters as <code>fxeditor_licence=fx_pk_...</code>.</p>' );
}

/** A link this tool made for a platform that only takes links (content.js) - show its equation. */
function equationPage( custom ) {
    var latex = String( custom.fxeditor_latex || '' );
    var image = String( custom.fxeditor_image || '' );
    if ( !content.isRenderedImage( image, RENDER_URL ) ) return null;
    return page( 'Equation', '<p>' + content.imageHtml( image, latex ) + '</p>' );
}

async function handleLaunch( context, request, response ) {
    var deployment;
    try {
        deployment = await deployments.recordLaunch( context.idToken, FXTEX_ORIGIN );
    } catch ( err ) {
        // Usage records are for licensing and billing, not for the person in front of the LMS:
        // a database hiccup here is logged, never a failed launch.
        console.error( 'fxeditor-lti: could not record launch: ' + err.message );
    }

    var custom = context.idToken.launch.custom || {};
    if ( context.idToken.launch.type === LtiMessageType.ResourceLinkRequest && custom.fxeditor_latex ) {
        var shown = equationPage( custom );
        if ( shown ) {
            response.html( shown );
            return;
        }
    }

    if ( LICENCE_MODE === 'enforce' && deployment && deployment.licence && !deployment.licence.licensed ) {
        response.html( unlicensedPage( deployment ) );
        return;
    }
    response.html( renderLaunchPage( context.ltik ) );
}

provider.onResourceLink( handleLaunch );
provider.onDeepLinking( handleLaunch );

// Read by views/launch.html on load, so it can tell a Deep Linking launch (Insert should
// return a Deep Linking response) from a Resource Link launch (Insert has nothing to send
// back), and to carry through the render/server hosts this deployment is configured with.
provider.httpHandler.registerRoute( '/config', [ HttpMethod.Get ], async function ( request, response ) {
    var ltik = request.query.ltik;
    if ( !ltik || typeof ltik !== 'string' ) {
        response.status( 400 ).json( { error: 'Missing ltik.' } );
        return;
    }

    var context;
    try {
        context = await provider.getLaunchContext( ltik );
    } catch ( err ) {
        response.status( 401 ).json( { error: 'Launch expired or invalid: ' + err.message } );
        return;
    }

    response.json( {
        isDeepLinking: context.deepLinking.isAvailable(),
        server: EQNEDITOR_SERVER,
        renderUrl: RENDER_URL,
        // Passed straight to EqEditor.init(). Every page here is on this tool's own address, so
        // this is the licence for that address - CodeCogs' own - whichever institution launched.
        licence: LICENCE,
        // How the editor looks, as JSON - see the `design` option in the README.
        design: parseDesign( process.env.EQNEDITOR_DESIGN ),
        // The maths view is the default and, by far, the more common thing to want on screen -
        // the LaTeX markup view is the opt-in. This is only the fallback for a first-time
        // visitor with no cookie yet - see views/launch.html.
        showLatex: process.env.EQNEDITOR_SHOW_LATEX === 'true'
    } );
} );

// Called once the instructor has built an equation and pressed Insert.
provider.httpHandler.registerRoute( '/insert', [ HttpMethod.Post ], async function ( request, response ) {
    var body = request.body || {};
    var ltik = body.ltik;
    var url = typeof body.url === 'string' ? body.url : '';
    var latex = typeof body.latex === 'string' ? body.latex.trim() : '';

    if ( !ltik || typeof ltik !== 'string' ) {
        response.status( 400 ).html( page( 'fxEditor', '<p>Missing launch token - go back and reopen the tool.</p>' ) );
        return;
    }
    if ( !latex || !content.isRenderedImage( url, RENDER_URL ) ) {
        response.status( 400 ).html( page( 'fxEditor', '<p>No equation to insert.</p>' ) );
        return;
    }

    var context;
    try {
        context = await provider.getLaunchContext( ltik );
    } catch ( err ) {
        response.status( 401 ).html( page( 'fxEditor', '<p>Launch expired - go back and reopen the tool.</p>' ) );
        return;
    }

    deployments.recordInsert( context.idToken ).catch( function ( err ) {
        console.error( 'fxeditor-lti: could not record insert: ' + err.message );
    } );

    if ( !context.deepLinking.isAvailable() ) {
        // Resource Link launch: nothing to hand back to the platform. The page is reached by
        // a real form submission (see views/launch.html) so the response has to be a page
        // too, not JSON - there is no script left on the client side to read JSON with once
        // the browser has already navigated here.
        response.html( page( 'Equation ready',
            '<p>Equation ready - copy the image below into your content, or use the equation button ' +
            'or content picker in your course\'s editor, which inserts it for you.</p>' +
            '<p>' + content.imageHtml( url, latex ) + '</p>' +
            '<p><code>' + escapeHtml( url ) + '</code></p>' ) );
        return;
    }

    var item = content.contentItemFor( context.idToken.services.deepLinking.acceptTypes,
        { url: url, latex: latex, toolUrl: TOOL_URL } );
    if ( !item ) {
        response.status( 400 ).html( page( 'fxEditor', '<p>This place in your course does not accept equations ' +
            '(it takes ' + escapeHtml( ( context.idToken.services.deepLinking.acceptTypes || [] ).join( ', ' ) || 'nothing' ) +
            '). Try the equation button in the editor instead.</p>' ) );
        return;
    }

    try {
        response.html( await context.deepLinking.createDeepLinkingForm( [ item ], { message: 'Equation inserted.' } ) );
    } catch ( err ) {
        console.error( 'fxeditor-lti: could not build Deep Linking response: ' + err.message );
        response.status( 500 ).html( page( 'fxEditor', '<p>Could not send the equation back to the platform.</p>' ) );
    }
} );

async function main() {
    // listen() connects the database before starting the HTTP listener; platformManager
    // needs that connection, so platforms can only be registered after it, not before.
    await provider.listen();
    console.log( 'fxeditor-lti: listening on port ' + PORT + ' as ' + TOOL_URL + ' (licences: ' + LICENCE_MODE + ')' );
    await platforms.registerPlatforms( provider );
}

main().catch( function ( err ) {
    console.error( 'fxeditor-lti: failed to start: ' + err.message );
    process.exit( 1 );
} );
