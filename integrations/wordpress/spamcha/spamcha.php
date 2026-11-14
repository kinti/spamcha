<?php
/**
 * Plugin Name: spamcha
 * Plugin URI:  https://spamcha.com
 * Description: Bridge to your own spamcha serve instance: the invisible, trainable, local spam judge. No captcha, no content sent to any cloud. Protects comments out of the box; developers get spamcha_verdict() for any form.
 * Version:     0.1.0
 * Author:      spamcha contributors
 * License:     MIT
 * Text Domain: spamcha
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Spamcha_Plugin {

	const OPT = 'spamcha_options';

	public static function options(): array {
		$o = get_option( self::OPT, array() );
		return wp_parse_args(
			is_array( $o ) ? $o : array(),
			array(
				'service_url' => 'http://127.0.0.1:8788',
				'protect_comments' => true,
				'quarantine_is_pending' => true,
			)
		);
	}

	private static function service( string $path ): string {
		$o = self::options();
		return rtrim( (string) $o['service_url'], '/' ) . $path;
	}

	/** The full verdict for a fields map: pass|quarantine|reject + reasons. */
	public static function verdict( array $fields ): array {
		$res = wp_remote_post(
			self::service( '/verdict' ),
			array(
				'timeout' => 5,
				'headers' => array(
					'content-type'      => 'application/x-www-form-urlencoded',
					'x-forwarded-for'   => (string) ( $_SERVER['REMOTE_ADDR'] ?? '' ),
				),
				'body'    => build_query( $fields ),
			)
		);
		if ( is_wp_error( $res ) || 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
			// Service down: never block real people on our own outage. Fail open.
			return array( 'decision' => 'pass', 'error' => true );
		}
		$body = json_decode( wp_remote_retrieve_body( $res ), true );
		return is_array( $body ) && isset( $body['decision'] ) ? $body : array( 'decision' => 'pass', 'error' => true );
	}

	/**
	 * Hidden stamp fields for any form, fetched FRESH per render.
	 * No transient: stamps are single-use: sharing one token across visitors
	 * would trigger the service's replay protection and reject real people.
	 */
	public static function stamp_html(): string {
		$res = wp_remote_get( self::service( '/stamp?format=html' ), array( 'timeout' => 5 ) );
		if ( is_wp_error( $res ) ) {
			return '';
		}
		$body = json_decode( wp_remote_retrieve_body( $res ), true );
		return is_array( $body ) && isset( $body['html'] ) ? (string) $body['html'] : '';
	}

	/* ── Comment protection ─────────────────────────────────────────────── */

	public function boot(): void {
		$o = self::options();
		if ( $o['protect_comments'] ) {
			add_filter( 'preprocess_comment', array( $this, 'judge_comment' ), 1 );
			add_action( 'comment_form_after_fields', array( $this, 'echo_stamp' ) );
			add_action( 'comment_form_logged_in_after', array( $this, 'echo_stamp' ) );
		}
		add_action( 'admin_menu', array( $this, 'admin_menu' ) );
		add_action( 'admin_init', array( $this, 'admin_settings' ) );
	}

	/** Runs before WP stores anything: reject, hold for moderation, or pass. */
	public function judge_comment( array $comment ): array {
		// Pass the form fields AS SUBMITTED: including the stamp and the
		// honeypot the service rendered. Fabricating them here would defeat
		// the stamp gate (the service would see missing/stale stamps and
		// reject every real comment).
		$fields = $_POST;
		$fields['mensaje'] = (string) ( $comment['comment_content'] ?? '' );
		$v = self::verdict( $fields );
		switch ( $v['decision'] ) {
			case 'reject':
				if ( isset( $v['error'] ) && $v['error'] ) {
					break; // fail-open handled above
				}
				wp_die(
					esc_html( __( 'Your submission was rejected as spam.', 'spamcha' ) ),
					403,
					array( 'response' => 403 )
				);
				break;
			case 'quarantine':
				// Review it at the spamcha panel: it might be legit: and teaching it trains the judge.
				$comment['comment_approved'] = 0;
				break;
		}
		return $comment;
	}

	public function echo_stamp(): void {
		echo self::stamp_html(); // phpcs:ignore WordPress.Security.EscapeOutput -- server-generated trusted HTML
	}

	/* ── Settings page ──────────────────────────────────────────────────── */

	public function admin_menu(): void {
		add_options_page( 'spamcha', 'spamcha', 'manage_options', 'spamcha', array( __CLASS__, 'settings_page' ) );
	}

	public function admin_settings(): void {
		register_setting( 'spamcha', self::OPT );
		add_settings_section( 'spamcha-main', __( 'spamcha service', 'spamcha' ), '__return_false', 'spamcha' );
		add_settings_field(
			'service_url',
			__( 'Service URL', 'spamcha' ),
			function () {
				$o = self::options();
				printf(
					'<input class="regular-text" type="url" name="%s[service_url]" value="%s"><p class="description">%s</p>',
					esc_attr( self::OPT ),
					esc_attr( $o['service_url'] ),
					esc_html__( 'Your spamcha serve instance, e.g. http://127.0.0.1:8788', 'spamcha' )
				);
			},
			'spamcha',
			'spamcha-main'
		);
		add_settings_field(
			'protect_comments',
			__( 'Protect comments', 'spamcha' ),
			function () {
				$o = self::options();
				printf(
					'<label><input type="checkbox" name="%s[protect_comments]" value="1" %s> %s</label>',
					esc_attr( self::OPT ),
					checked( $o['protect_comments'], true, false ),
					esc_html__( 'Judge comments through the service (quarantine = hold for moderation)', 'spamcha' )
				);
			},
			'spamcha',
			'spamcha-main'
		);
	}

	public static function settings_page(): void {
		$o    = self::options();
		$ping = wp_remote_get( self::service( '/health' ), array( 'timeout' => 5 ) );
		$ok   = ! is_wp_error( $ping ) && 200 === (int) wp_remote_retrieve_response_code( $ping );
		echo '<div class="wrap"><h1>spamcha</h1>';
		echo $ok
			? '<p><strong style="color:#067d17">✓ ' . esc_html__( 'Service reachable.', 'spamcha' ) . '</strong></p>'
			: '<p><strong style="color:#da1e28">✗ ' . esc_html__( 'Service NOT reachable: is spamcha serve running?', 'spamcha' ) . '</strong></p>';
		echo '<p><a href="' . esc_url( self::service( '/panel' ) ) . '" target="_blank" rel="noopener">' .
			esc_html__( 'Open the panel (what arrived, quarantine review)', 'spamcha' ) . ' ↗</a></p>';
		echo '<p>' . esc_html__( 'Quarantined comments are held for moderation here in WordPress too: review both places: marking spam in the spamcha panel trains your local judge.', 'spamcha' ) . '</p>';
		echo '<form action="options.php" method="post">';
		settings_fields( 'spamcha' );
		do_settings_sections( 'spamcha' );
		submit_button();
		echo '</form></div>';
	}
}

new Spamcha_Plugin()->boot();

/** For theme/plugin devs: judge any fields array yourself. */
function spamcha_verdict( array $fields ): array {
	return Spamcha_Plugin::verdict( $fields );
}
