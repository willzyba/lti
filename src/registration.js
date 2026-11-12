/**
 * LTI Dynamic Registration: an LMS administrator pastes one URL - https://<this tool>/register -
 * and the LMS and this tool exchange everything else themselves, instead of the values being
 * copied between two admin screens by hand. Moodle, Canvas and Brightspace support it.
 *
 * ltijs builds the registration request, but its defaults ask for more than this tool needs: the
 * grade and roster services (Assignment and Grade Services, Names and Role Provisioning) and every
 * claim the platform offers - names and email addresses among them. This tool only inserts
 * content, so the request is narrowed here:
 *
 *   - no service scopes at all;
 *   - claims: just iss and sub - who issued the launch and an opaque id for the person. Moodle
 *     reads this list to decide whether to send names and email (registration_helper.php: only
 *     if they are in it), so asking for neither means neither is sent;
 *   - Canvas: privacy_level "anonymous" (its own switch for the same thing), and the equation
 *     button in its Rich Content Editor (the editor_button placement).
 *
 * New registrations are active at once (autoActivate): whether an institution may use the tool
 * is a licensing question, answered at launch (deployments.js), not an approval step here.
 */

var TOOL_CONFIGURATION = 'https://purl.imsglobal.org/spec/lti-tool-configuration';
var PLATFORM_CONFIGURATION = 'https://purl.imsglobal.org/spec/lti-platform-configuration';

function options( toolUrl ) {
    return {
        name: 'fxEditor',
        url: toolUrl,
        logo: toolUrl + '/logo.svg',
        description: 'Write equations in LaTeX or with the toolbar, and insert them into course content.',
        useDeepLinking: true,
        autoActivate: true,
        deepLinkingMessage: { label: 'Equation (fxEditor)', iconUri: toolUrl + '/logo.svg' }
    };
}

/** What to change in ltijs' registration request for this platform. */
function overridesFor( configuration, toolUrl ) {
    var family = ( ( configuration[ PLATFORM_CONFIGURATION ] || {} ).product_family_code || '' ).toLowerCase();
    var toolConfiguration = { claims: [ 'iss', 'sub' ] };

    if ( family === 'canvas' ) {
        toolConfiguration[ 'https://canvas.instructure.com/lti/privacy_level' ] = 'anonymous';
        toolConfiguration.messages = [ {
            type: 'LtiDeepLinkingRequest',
            target_link_uri: toolUrl + '/launch',
            label: 'Equation (fxEditor)',
            icon_uri: toolUrl + '/logo.svg',
            placements: [ 'editor_button' ]
        } ];
    }

    var overrides = {};
    // undefined rather than '': JSON.stringify leaves the key out, so no scope is asked for at all.
    overrides.scope = undefined;
    overrides[ TOOL_CONFIGURATION ] = toolConfiguration;
    return overrides;
}

/**
 * Takes over ltijs' /register route so every registration carries the overrides above. The
 * response is ltijs' own closing snippet, which tells the LMS the registration is done.
 */
function install( provider, toolUrl ) {
    var service = provider.dynamicRegistrationService;
    service.setHandler( async function ( request, response ) {
        var openidConfiguration = request.query.openid_configuration;
        var registrationToken = request.query.registration_token;
        if ( !openidConfiguration || typeof openidConfiguration !== 'string' ) {
            response.status( 400 ).html( '<p>This address is for an LMS administrator to register fxEditor with Dynamic Registration - open it from the LMS, not directly.</p>' );
            return;
        }
        try {
            var configuration = await service.getOpenIDConfiguration( openidConfiguration );
            var platform = await service.performRegistration( configuration,
                typeof registrationToken === 'string' ? registrationToken : undefined,
                overridesFor( configuration, toolUrl ) );
            console.log( 'fxeditor-lti: registered ' + configuration.issuer + ' as "' + platform.name + '"' );
            response.html( service.FINALIZE_REGISTRATION_HTML_SNIPPET );
        } catch ( err ) {
            console.error( 'fxeditor-lti: registration failed: ' + err.message );
            response.status( 500 ).html( '<p>fxEditor could not complete the registration: ' +
                String( err.message ).replace( /[<>&"]/g, '' ) + '</p>' );
        }
    } );
}

module.exports = { options: options, overridesFor: overridesFor, install: install };
