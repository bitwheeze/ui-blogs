import React from 'react';
import { renderToNodeStream } from 'react-dom/server';
import stringToStream from 'string-to-stream';
import multiStream from 'multistream';
import { ServerStyleSheet } from 'styled-components'
// import Tarantool from 'db/tarantool';
import ServerHTML from './server-html';
import { serverRender } from '../shared/UniversalRender';
import models from 'db/models';
import secureRandom from 'secure-random';
import ErrorPage from 'server/server-error';
import {
  DEFAULT_LANGUAGE, LANGUAGES, LOCALE_COOKIE_KEY,
  SELECT_TAGS_KEY
} from 'app/client_config';

const DB_RECONNECT_TIMEOUT = process.env.NODE_ENV === 'development' ? 1000 * 60 * 60 : 1000 * 60 * 10;

async function appRender(ctx) {
    const store = {};
    try {
        let select_tags = [];
        try {
            select_tags = JSON.parse(decodeURIComponent(ctx.cookies.get(SELECT_TAGS_KEY) || '[]') || '[]') || [];
        } catch(e) {}

        const offchain = {
            csrf: ctx.csrf,
            flash: ctx.flash,
            new_visit: ctx.session.new_visit,
            account: ctx.session.a,
            config: $STM_Config,
            locale: Object.keys(LANGUAGES).indexOf(ctx.cookies.get(LOCALE_COOKIE_KEY)) !== -1 ? ctx.cookies.get(LOCALE_COOKIE_KEY) : DEFAULT_LANGUAGE,
            select_tags
        };

        const user_id = ctx.session.user;
        if (user_id) {
            let user = null;
            if (appRender.dbStatus.ok || (new Date() - appRender.dbStatus.lastAttempt) > DB_RECONNECT_TIMEOUT) {
                try {
                    user = await models.User.findOne({
                        attributes: ['name', 'email', 'picture_small'],
                        where: {id: user_id},
                        include: [{model: models.Account, attributes: ['name', 'ignored']}],
                        logging: false
                    });
                    appRender.dbStatus = {ok: true};
                } catch (e) {
                    appRender.dbStatus = {ok: false, lastAttempt: new Date()};
                    console.error('WARNING! mysql query failed: ', e.toString());
                    offchain.serverBusy = true;
                }
            } else {
                offchain.serverBusy = true;
            }
            if (user) {
                let account = null;
                for (const a of user.Accounts) {
                    if (!a.ignored) {
                        account = a.name;
                        break;
                    }
                }
                offchain.user = {
                    id: user_id,
                    name: user.name,
                    email: user.email,
                    picture: user.picture_small,
                    prv: ctx.session.prv,
                    account
                }
            }
        }

        const start = new Date()
        const {
          body,
          title,
          statusCode,
          meta
        } = await serverRender({
          location: ctx.request.url,
          store,
          offchain,
          ErrorPage,
          // tarantool: Tarantool.instance('tarantool')
        });

        // Assets name are found in `webpack-stats` file
        const assets_filename = process.env.NODE_ENV === 'production' ? 'tmp/webpack-isotools-assets-prod.json' : 'tmp/webpack-isotools-assets-dev.json';
        const assets = require(assets_filename);

        // Don't cache assets name on dev
        if (process.env.NODE_ENV === 'development') {
            delete require.cache[require.resolve(assets_filename)];
        }

        const analytics = {
            google_analytics_id: $STM_Config.google_analytics_id,
        };

        const props = { body, assets, title, meta, analytics};
        const sheet = new ServerStyleSheet()
        const jsx = sheet.collectStyles(<ServerHTML {...props} />)
        const stream = sheet.interleaveWithNodeStream(renderToNodeStream(jsx))

        ctx.status = statusCode;
        ctx.type = 'text/html'
        ctx.body = multiStream([stringToStream('<!DOCTYPE html>'), stream])
    } catch (err) {
        // Render 500 error page from server
        const { error, redirect } = err;
        if (error) throw error;

        // Handle component `onEnter` transition
        if (redirect) {
            const { pathname, search } = redirect;
            ctx.redirect(pathname + search);
        }

        throw err;
    }
}

appRender.dbStatus = {ok: true};
module.exports = appRender;
