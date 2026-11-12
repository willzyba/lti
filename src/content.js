/**
 * What an equation becomes when it is handed back to the LMS in a Deep Linking response.
 *
 * Each platform's placement says which content item types it will take (accept_types), and the
 * spec lets it accept several at once (accept_multiple) - in which case ltijs passes on every
 * item of an accepted type, and offering the same equation as html, image and link would insert
 * it three times. So exactly one item is built here, the best kind the placement takes:
 *
 *   html             An <img> with the LaTeX as its alt text - what an editor button inserts
 *                    in place (Canvas's Rich Content Editor, Brightspace's Insert Stuff).
 *   image            The same picture as a bare image item, for a placement that takes images
 *                    but not markup.
 *   link             A link to the image, for one that takes neither.
 *   ltiResourceLink  A link back to this tool that shows the equation when opened - Moodle
 *                    takes only these, from the activity chooser's "Select content". The
 *                    equation travels in the link's own custom parameters, so nothing about it
 *                    is stored here.
 */

var PREFERENCE = [ 'html', 'image', 'link', 'ltiResourceLink' ];

function escapeHtml( s ) {
    return String( s )
        .replace( /&/g, '&amp;' ).replace( /</g, '&lt;' )
        .replace( />/g, '&gt;' ).replace( /"/g, '&quot;' );
}

/**
 * Whether `url` is an image from the renderer this deployment is configured with. The address
 * arrives from the browser, so it is checked rather than trusted: it ends up in a course page.
 */
function isRenderedImage( url, renderUrl ) {
    var image, renderer;
    try {
        image = new URL( url );
        renderer = new URL( renderUrl );
    } catch ( e ) {
        return false;
    }
    return image.protocol === renderer.protocol && image.host === renderer.host;
}

function imageHtml( url, latex ) {
    return '<img class="fxeditor-equation" src="' + escapeHtml( url ) + '" alt="' + escapeHtml( latex ) +
        '" title="' + escapeHtml( latex ) + '" style="vertical-align:middle">';
}

/**
 * The one content item for this placement, or null when it takes none of the kinds above.
 *
 * @param {readonly string[]|undefined} acceptTypes  the launch's deep linking accept_types
 * @param {{url: string, latex: string, toolUrl: string}} equation
 */
function contentItemFor( acceptTypes, equation ) {
    var accepted = acceptTypes || [];
    var type = PREFERENCE.find( function ( t ) { return accepted.indexOf( t ) !== -1; } );

    switch ( type ) {
        case 'html':
            return { type: 'html', html: imageHtml( equation.url, equation.latex ) };
        case 'image':
            return { type: 'image', url: equation.url, text: equation.latex };
        case 'link':
            return { type: 'link', url: equation.url, title: equation.latex };
        case 'ltiResourceLink':
            return {
                type: 'ltiResourceLink',
                title: 'Equation',
                text: equation.latex,
                url: equation.toolUrl.replace( /\/+$/, '' ) + '/launch',
                custom: { fxeditor_latex: equation.latex, fxeditor_image: equation.url }
            };
        default:
            return null;
    }
}

module.exports = { contentItemFor: contentItemFor, isRenderedImage: isRenderedImage, imageHtml: imageHtml, escapeHtml: escapeHtml };
