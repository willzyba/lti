/**
 * Who is using this tool, and whether they are licensed to.
 *
 * fxTeX Pro licenses the address of the page it runs on, and every page here runs on this tool's
 * own address, whichever institution opened it - so the page's licence is CodeCogs' own, and
 * says nothing about the institution. What identifies an institution in LTI is its registration:
 * the platform (issuer), the client id it issued this tool, and the deployment id of the
 * installation. One record per deployment is kept here, with what it is licensed under and how
 * much it is used, month by month.
 *
 * An institution is licensed one of two ways, both checked against the same registry fxtex uses
 * for every other licence (its /diagnostics.json, which reports without spending any allowance):
 *
 *   - by key: its LMS administrator puts the institution's licence key in the tool's custom
 *     parameters as fxeditor_licence=fx_pk_..., and every launch carries it;
 *   - by address: the LMS's own address (school.instructure.com, say) is a registered domain on
 *     the institution's licence, as a website's would be.
 *
 * Nothing here identifies a person: no user id, name or course is stored - only the
 * deployment's identifiers and counts.
 */

var mongoose = require( 'mongoose' );

// How long a licence answer is trusted before fxtex is asked again.
var LICENCE_TTL_MS = 60 * 60 * 1000;

var Deployment = mongoose.models.FxDeployment || mongoose.model( 'FxDeployment', new mongoose.Schema( {
    _id: String,                  // issuer|clientId|deploymentId
    issuer: String,
    clientId: String,
    deploymentId: String,
    platform: { family: String, name: String, guid: String },
    host: String,                 // the LMS's own address, from the launch's return URLs
    licence: {
        licensed: Boolean,
        client: String,           // the licence fxtex matched, never the key itself
        tier: String,
        via: String,              // 'key', 'domain', or '' when neither matched
        checkedAt: Date
    },
    firstLaunch: Date,
    lastLaunch: Date,
    launches: { type: Number, default: 0 },
    inserts: { type: Number, default: 0 },
    usage: { type: Map, of: { launches: Number, inserts: Number }, default: {} }
}, { collection: 'fxdeployments', versionKey: false } ) );

function deploymentKey( platform ) {
    return [ platform.url, platform.clientId, platform.deploymentId ].join( '|' );
}

function hostOf( url ) {
    try {
        return new URL( url ).host.toLowerCase();
    } catch ( e ) {
        return '';
    }
}

/**
 * The LMS's own address. The issuer will not do: Canvas and Blackboard use one issuer for every
 * customer (canvas.instructure.com, blackboard.com). The return URLs a launch carries point back
 * into the institution's own site, so they are tried first.
 */
function lmsHost( idToken ) {
    var deepLinking = idToken.services && idToken.services.deepLinking;
    var presentation = idToken.launch && idToken.launch.presentation;
    return hostOf( deepLinking && deepLinking.deepLinkReturnUrl ) ||
        hostOf( presentation && presentation.returnUrl ) ||
        hostOf( idToken.platform.url );
}

function licenceKeyOf( idToken ) {
    var custom = ( idToken.launch && idToken.launch.custom ) || {};
    var key = custom.fxeditor_licence;
    return typeof key === 'string' && /^fx_[a-z]+_[A-Za-z0-9]+$/.test( key.trim() ) ? key.trim() : '';
}

/**
 * Asks fxtex what this institution is licensed for. A failure to ask is not a verdict: it
 * answers null, and the caller keeps whatever it knew before.
 */
async function checkLicence( fxtexOrigin, host, key ) {
    var headers = {};
    if ( host ) headers.Referer = 'https://' + host + '/';
    if ( key ) headers[ 'X-API-Key' ] = key;

    try {
        var response = await fetch( fxtexOrigin + '/diagnostics.json', { headers: headers, signal: AbortSignal.timeout( 5000 ) } );
        if ( !response.ok ) return null;
        var d = await response.json();
        // "*" is fxtex's catch-all for an unregistered caller - the free demo allowance, not a licence.
        var licensed = !!d.allowed && !!d.client && d.client !== '*';
        return {
            licensed: licensed,
            client: licensed ? String( d.client ) : '',
            tier: String( d.tier || '' ),
            via: !licensed ? '' : d.access === 'allowed-by-key' ? 'key' : 'domain',
            checkedAt: new Date()
        };
    } catch ( err ) {
        console.warn( 'fxeditor-lti: licence check failed: ' + err.message );
        return null;
    }
}

function monthKey( date ) {
    return date.toISOString().slice( 0, 7 );
}

/**
 * Records a launch and returns the deployment, its licence brought up to date when the last
 * answer is older than LICENCE_TTL_MS (or the licence key in the launch has changed).
 */
async function recordLaunch( idToken, fxtexOrigin ) {
    var platform = idToken.platform;
    var id = deploymentKey( platform );
    var now = new Date();
    var host = lmsHost( idToken );
    var key = licenceKeyOf( idToken );

    var inc = { launches: 1 };
    inc[ 'usage.' + monthKey( now ) + '.launches' ] = 1;

    var deployment = await Deployment.findOneAndUpdate( { _id: id }, {
        $setOnInsert: { issuer: platform.url, clientId: platform.clientId, deploymentId: platform.deploymentId, firstLaunch: now },
        $set: {
            lastLaunch: now,
            host: host,
            platform: { family: platform.productFamilyCode || '', name: platform.name || '', guid: platform.guid || '' }
        },
        $inc: inc
    }, { upsert: true, returnDocument: 'after' } ).lean();

    var licence = deployment.licence;
    var keyChanged = key && ( !licence || licence.via !== 'key' );
    if ( !licence || !licence.checkedAt || keyChanged || now - new Date( licence.checkedAt ) > LICENCE_TTL_MS ) {
        var fresh = await checkLicence( fxtexOrigin, host, key );
        if ( fresh ) {
            await Deployment.updateOne( { _id: id }, { $set: { licence: fresh } } );
            deployment.licence = fresh;
        }
    }
    return deployment;
}

async function recordInsert( idToken ) {
    var inc = { inserts: 1 };
    inc[ 'usage.' + monthKey( new Date() ) + '.inserts' ] = 1;
    await Deployment.updateOne( { _id: deploymentKey( idToken.platform ) }, { $inc: inc } );
}

/**
 * Whether the institution behind a launch is licensed, as last recorded by recordLaunch() - the
 * launch itself has recorded it by the time its page asks. False when it is not, or not known.
 */
async function isLicensed( idToken ) {
    var deployment = await Deployment.findById( deploymentKey( idToken.platform ), { licence: 1 } ).lean();
    return !!( deployment && deployment.licence && deployment.licence.licensed );
}

module.exports = { recordLaunch: recordLaunch, recordInsert: recordInsert, isLicensed: isLicensed, lmsHost: lmsHost, Deployment: Deployment };
