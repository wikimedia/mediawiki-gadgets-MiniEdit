/**
 * MiniEdit is a tool for quickly doing small edits without leaving the page.
 *
 * Documentation: https://www.mediawiki.org/wiki/MiniEdit
 * License: GNU General Public License 3 or later (http://www.gnu.org/licenses/gpl-3.0.html)
 * Author: Felipe Schenone (User:Sophivorus)
 */
window.MiniEdit = {

	/**
	 * Will hold the wikitext of the current page
	 */
	pageWikitext: '',

	/**
	 * Initialization script
	 */
	init: function () {

		// Only init when viewing
		var action = mw.config.get( 'wgAction' );
		if ( action !== 'view' ) {
			return;
		}

		// Only init in useful namespaces
		var namespaces = [ 0, 2, 4, 12, 14 ];
		var namespace = mw.config.get( 'wgNamespaceNumber' );
		var talk = namespace % 2 === 1; // Talk pages always have odd namespaces
		if ( !namespaces.includes( namespace ) && !talk ) {
			return;
		}

		// Only init in wikitext pages
		var model = mw.config.get( 'wgPageContentModel' );
		if ( model !== 'wikitext' ) {
			return;
		}

		// Select only paragraphs that are direct children
		// to reduce the chances of matching paragraphs that come from templates
		var selector = '#mw-content-text > .mw-parser-output > p';
		if ( mw.config.get( 'skin' ) === 'minerva' ) {
			selector = '#mw-content-text > .mw-parser-output > section > p';
		}
		$( selector ).each( MiniEdit.addEditButton );
	},

	/**
	 * Add an edit button
	 */
	addEditButton: function () {
		var $paragraph = $( this );

		// Skip empty paragraphs
		if ( !$paragraph.text().trim() ) {
			return;
		}

		// Make the edit button
		var path = '<path fill="currentColor" d="M16.77 8l1.94-2a1 1 0 0 0 0-1.41l-3.34-3.3a1 1 0 0 0-1.41 0L12 3.23zm-5.81-3.71L1 14.25V19h4.75l9.96-9.96-4.75-4.75z"></path>';
		var icon = '<svg width="14" height="14" viewBox="0 0 20 20">' + path + '</svg>';
		var $button = $( '<span class="miniedit-button noprint">' + icon + '</span>' );
		$button.on( 'click', MiniEdit.onEditButtonClick );

		// Only show the button when the user hovers over the paragraph
		// On mobile devices there's no hover event, so we just skip this part and show the button always
		if ( mw.config.get( 'skin' ) !== 'minerva' ) {
			$button.hide();
			$paragraph.on( 'mouseenter', function () { $button.show(); } );
			$paragraph.on( 'mouseleave', function () { $button.hide(); } );
		}

		// This is the only CSS the tool needs so it's not worth a stylesheet
		$button.css( { 'color': '#a2a9b1', 'cursor': 'pointer' } );
		$button.on( 'mouseenter', function () { $( this ).css( 'color', '#202122' ); } );
		$button.on( 'mouseleave', function () { $( this ).css( 'color', '#a2a9b1' ); } );

		// Add to the DOM
		$paragraph.append( ' ', $button );
	},

	/**
	 * Handle a click on an edit button
	 */
	onEditButtonClick: function () {
		var $button = $( this ).closest( '.miniedit-button' );
		var $paragraph = $button.parent();

		// Save the original paragraph in case we need to restore it later
		// However, for some reason the hover events on the button are not getting cloned, so we remake the button
		var $original = $paragraph.clone( true );
		$original.find( '.miniedit-button' ).remove();
		MiniEdit.addEditButton.call( $original );

		// pageWikitext serves as a flag signaling that the dependencies were already loaded by a previous click
		if ( MiniEdit.pageWikitext ) {
			MiniEdit.addEditForm( $paragraph, $original );
			return;
		}

		// If we reach this point, we need to load the dependencies
		// First, we replace the button for a loading spinner
		// to prevent further clicks and to signal the user that something's happening
		var $spinner = MiniEdit.getSpinner();
		$button.replaceWith( $spinner );

		// Then we load dependencies
		$.when(
			MiniEdit.getPageWikitext(),
			MiniEdit.getMessages( 'en' )
		).done( function () {
			// Note the special treatment of getMessages( pageLanguage )
			// because it may fail if a translation doesn't exist yet
			// and because its success callback needs to run AFTER getMessages( 'en' )
			var pageLanguage = mw.config.get( 'wgPageContentLanguage' );
			MiniEdit.getMessages( pageLanguage ).always( function () {
				MiniEdit.addEditForm( $paragraph, $original );
			} );
		} );
	},

	/**
	 * Add an edit form
	 */
	addEditForm: function ( $paragraph, $original ) {
		// If no relevant wikitext for the element is found, fallback to regular edit
		var wikitext = MiniEdit.getParagraphWikitext( $paragraph );
		if ( !wikitext ) {
			var $section = MiniEdit.getSection( $paragraph );
			var sectionNumber = $section ? 1 + $section.prevAll( ':header' ).length : 0;
			var editUrl = mw.util.getUrl( null, { action: 'edit', section: sectionNumber } );
			window.location.href = editUrl;
			return;
		}

		// Make the form
		var wikitextInput = new OO.ui.MultilineTextInputWidget( { name: 'wikitext', value: wikitext, autofocus: true, autosize: true } );
		var wikitextLayout = new OO.ui.HorizontalLayout( { items: [ wikitextInput ] } );
		var summaryInput = new OO.ui.TextInputWidget( { name: 'summary', placeholder: mw.msg( 'miniedit-form-summary' ) } );
		var summaryLayout = new OO.ui.HorizontalLayout( { items: [ summaryInput ] } );

		// Anons can't mark edits as minor
		if ( !mw.user.isAnon() ) {
			var minorCheckbox = new OO.ui.CheckboxInputWidget( { name: 'minor' } );
			var minorLayout = new OO.ui.FieldLayout( minorCheckbox, { label: mw.msg( 'miniedit-form-minor' ), align: 'inline' } );
			summaryLayout.addItems( [ minorLayout ] );
			summaryLayout.$element.find( '.oo-ui-fieldLayout' ).css( 'vertical-align', 'text-bottom' ); // Minor alignment fix
		}

		// Add the buttons
		var publishButton = new OO.ui.ButtonInputWidget( { label: mw.msg( 'miniedit-form-publish' ), flags: [ 'primary', 'progressive' ] } );
		var cancelButton = new OO.ui.ButtonInputWidget( { label: mw.msg( 'miniedit-form-cancel' ), flags: 'destructive', framed: false } );
		var formLayout = new OO.ui.FormLayout( { items: [ wikitextLayout, summaryLayout, publishButton, cancelButton ] } );

		// Add to the DOM
		var $form = formLayout.$element;
		$paragraph.html( $form );

		// Handle a submission
		publishButton.on( 'click', MiniEdit.onSubmit, [ $paragraph, $original, $form, wikitext, publishButton, cancelButton ] );

		// Handle a cancel
		cancelButton.on( 'click', function () {
			$paragraph.replaceWith( $original );
		} );
	},

	/**
	 * Handle a submission
	 */
	onSubmit: function ( $paragraph, $original, $form, oldWikitext, publishButton, cancelButton ) {
		var newWikitext = $form.find( 'textarea[name="wikitext"]' ).val();

		// If no changes were made, just restore the original element
		if ( oldWikitext === newWikitext ) {
			$paragraph.replaceWith( $original );
			return;
		}

		// Disable the buttons to prevent further clicks and to signal the user that something's happening
		publishButton.setDisabled( true );
		cancelButton.setDisabled( true );

		// Get the rest of the form data
		var summary = $form.find( 'input[name="summary"]' ).val();
		var minor = $form.find( 'input[name="minor"]' ).prop( 'checked' );

		// Fix excessive line breaks
		newWikitext = newWikitext.trim();
		newWikitext = newWikitext.replace( /\n\n\n+/g, '\n\n' );

		// If the paragraph was deleted, remove also any trailing newlines
		if ( !newWikitext ) {
			oldWikitext = oldWikitext.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ); // Escape special characters
			oldWikitext = new RegExp( oldWikitext + '\n+' );
		}

		MiniEdit.pageWikitext = MiniEdit.pageWikitext.replace( oldWikitext, newWikitext );
		var params = {
			'action': 'edit',
			'title': mw.config.get( 'wgPageName' ),
			'text': MiniEdit.pageWikitext,
			'minor': minor,
			'summary': MiniEdit.makeSummary( summary, $form, newWikitext ),
			'tags': mw.config.get( 'miniedit-tag' )
		};
		new mw.Api().postWithEditToken( params ).done( function () {
			MiniEdit.onSuccess( $paragraph, newWikitext );
		} );
	},

	/**
	 * Callback on successful edits
	 */
	onSuccess: function ( $paragraph, newWikitext ) {
		if ( !newWikitext ) {
			$paragraph.remove();
			return;
		}
		var params = {
			'action': 'parse',
			'title': mw.config.get( 'wgPageName' ),
			'text': newWikitext,
			'formatversion': 2,
			'prop': 'text',
			'disablelimitreport': true,
		};
		new mw.Api().get( params ).done( function ( data ) {
			var text = data.parse.text;
			var $html = $( text );
			var $paragraphs = $html.find( 'p' );
			$paragraph.replaceWith( $paragraphs );
			$paragraphs.each( MiniEdit.addEditButton );
		} );
	},

	/**
	 * Get the wikitext of the current page
	 */
	getPageWikitext: function () {
		var params = {
			'page': mw.config.get( 'wgPageName' ),
			'action': 'parse',
			'prop': 'wikitext',
			'formatversion': 2,
		};
		return new mw.Api().get( params ).done( function ( data ) {
			MiniEdit.pageWikitext = data.parse.wikitext;
		} );
	},

	/**
	 * Get messages from the Wikimedia repository
	 */
	getMessages: function ( language ) {
		return $.get( '//gerrit.wikimedia.org/r/plugins/gitiles/mediawiki/gadgets/MiniEdit/+/master/i18n/' + language + '.json?format=text', function ( data ) {
			var json = MiniEdit.decodeBase64( data );
			var messages = JSON.parse( json );
			delete messages[ '@metadata' ];
			mw.messages.set( messages );
		} );
	},

	/**
	 * Helper method to get the relevant wikitext that corresponds to a given paragraph
	 *
	 * This is actually the heart of the tool
	 * It's a heuristic method to try to find the relevant wikitext
	 * that corresponds to the paragraph being edited
	 * Since wikitext and HTML are different markups
	 * the only place where they are the same is in plain text fragments
	 * so we find the longest plain text fragment in the HTML
	 * then we search for that same fragment in the wikitext
	 * and return the entire line of wikitext containing that fragment
	 * or null if anything goes wrong
	 *
	 * @param {jQuery object} jQuery object representing the DOM element being edited
	 * @return {string|null} Wikitext of the paragraph being edited, or null if it can't be found
	 */
	getParagraphWikitext: function ( $paragraph ) {
		// The longest text node has the most chances of being unique
		var text = MiniEdit.getLongestText( $paragraph );

		// Some paragraphs may not have text nodes at all
		if ( !text ) {
			return;
		}

		// Match all lines that contain the text
		text = text.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ); // Escape special characters
		var regexp = new RegExp( '.*' + text + '.*', 'g' );
		var matches = MiniEdit.pageWikitext.match( regexp );

		// This may happen if the paragraph comes from a template
		if ( !matches ) {
			return;
		}

		// This may happen if the longest text is very short and repeats somewhere else
		if ( matches.length > 1 ) {
			return;
		}

		// We got our relevant wikitext line
		return matches[0];
	},

	/**
	 * Helper method to get the text of the longest text node
	 */
	getLongestText: function ( $paragraph ) {
		var text = '';
		var $textNodes = $paragraph.contents().filter( function () {
			return this.nodeType === 3; // Text node
		} );
		$textNodes.each( function () {
			var nodeText = $( this ).text().trim();
			if ( nodeText.length > text.length ) {
				text = nodeText;
			}
		} );
		return text;
	},

	/**
	 * Helper method to build a helpful edit summary
	 */
	makeSummary: function ( summary, $paragraph, wikitext ) {
		if ( !summary ) {
			var action = wikitext ? 'edit' : 'delete';
			summary = mw.msg( 'miniedit-summary-' + action );
		}
		var $section = MiniEdit.getSection( $paragraph );
		if ( $section ) {
			var section = $section.find( '.mw-headline' ).attr( 'id' ).replaceAll( '_', ' ' );
			summary = '/* ' + section + ' */ ' + summary;
		}
		var page = mw.config.get( 'miniedit-page', 'mw:MiniEdit' );
		summary += ' [[' + page + '| #miniedit]]'; // For https://hashtags.wmcloud.org
		return summary;
	},

	/**
	 * Helper method to find the closest section
	 * by traversing back and up the DOM tree
	 *
	 * @param {jQuery object} Starting element
	 * @return {jQuery object} Closest section
	 */
	getSection: function ( $element ) {
		if ( $element.attr( 'id' ) === 'mw-content-text' ) {
			return;
		}
		if ( $element.is( ':header' ) ) {
			return $element;
		}
		var $previous = $element.prevAll( ':header' ).first();
		if ( $previous.length ) {
			return $previous;
		}
		var $parent = $element.parent();
		return MiniEdit.getSection( $parent );
	},

	/**
	 * Helper method to get a spinner (loading) icon
	 */
	 getSpinner: function () {
		var spinner = '<svg class="miniedit-spinner" width="14" height="14" viewBox="0 0 100 100">';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" opacity="0.000" transform="rotate(-90 50 50)" />';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" opacity="0.125" transform="rotate(-45 50 50)" />';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" opacity="0.250" transform="rotate(0 50 50)" />';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" opacity="0.375" transform="rotate(45 50 50)" />';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" opacity="0.500" transform="rotate(90 50 50)" />';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" opacity="0.625" transform="rotate(135 50 50)" />';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" opacity="0.750" transform="rotate(180 50 50)" />';
		spinner += '<rect fill="#555555" height="10" rx="5" ry="5" width="28" x="67" y="45" opacity="0.875" transform="rotate(225 50 50)" />';
		spinner += '</svg>';
		var $spinner = $( spinner );
		var degrees = 0;
		setInterval( function () {
			degrees += 45;
			$spinner.css( 'transform', 'rotate(' + degrees + 'deg)' );
		}, 100 );
		return $spinner;
	},

	/**
	 * Helper method to decode base64 strings
	 * See https://stackoverflow.com/questions/30106476
	 *
	 * @param {string} Encoded string
	 * @return {string} Decoded string
	 */
	decodeBase64: function ( string ) {
		return decodeURIComponent( window.atob( string ).split( '' ).map( function ( character ) {
			return '%' + ( '00' + character.charCodeAt( 0 ).toString( 16 ) ).slice( -2 );
		} ).join( '' ) );
	}
};

mw.loader.using( [
	'mediawiki.api',
	'mediawiki.user',
	'mediawiki.util',
	'oojs-ui-core',
	'oojs-ui-widgets'
], MiniEdit.init );
