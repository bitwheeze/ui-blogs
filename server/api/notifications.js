import koa_router from 'koa-router';
import koa_body from 'koa-body';
import Tarantool from 'db/tarantool';
import config from 'config';
//import webPush from 'web-push';
import { checkCSRF } from "server/utils/misc";

function toResArray(result) {
    if (!result || result.length < 1) return [];
    return result[0].slice(1);
}

export default function useNotificationsApi(app) {
    const router = koa_router({prefix: '/api/v1'});
    app.use(router.routes());
    const koaBody = koa_body();

    router.get('/notifications/subscribe/:account/:subscriber_id?', function *() {
        let { account, subscriber_id } = this.params;
        if (!subscriber_id) {
            subscriber_id = Math.floor(Math.random() * 10000);
        }

        try {
            const res = yield Tarantool.instance('tarantool').call('notification_subscribe', account, subscriber_id);
        } catch (error) {
            console.error(`[reqid ${this.request.header['x-request-id']}] ${this.method} ERRORLOG notifications @${account} ${error.message}`);
            this.body = { subscriber_id: null };
            return;
        }

        this.body = {
            subscriber_id,
        };
    });

    router.get('/notifications/take/:account/:subscriber_id/:task_ids?', function *() {
        const { account, subscriber_id, task_ids } = this.params;

        const remove_task_ids = task_ids ? task_ids.split('-').map(x=>+x) : [];

        try {
            const res = yield Tarantool.instance('tarantool').call('notification_take', account, subscriber_id, remove_task_ids);
            this.body = { tasks: [res[0]] };
        } catch (error) {
            console.error(`[reqid ${this.request.header['x-request-id']}] ${this.method} ERRORLOG notifications @${account} ${error.message}`);
            this.body = { tasks: null };
        }
    });

    // get all notifications for account
    router.get('/notifications/:account', function *() {
        const account = this.params.account;
 
        if (!account || account !== this.session.a) {
            this.body = []; return;
        }

        try {
            const res = yield Tarantool.instance('tarantool').select('notifications', 0, 1, 0, 'eq', account);
            this.body = toResArray(res);
        } catch (error) {
            console.error(`[reqid ${this.request.header['x-request-id']}] ${this.session.uid} ${this.method} ERRORLOG notifications @${account} ${error.message}`);
            this.body = [];
        }
        return;
    });

    // mark account's notification as read
    router.put('/notifications/:account/:ids', function *() {
        const {account, ids} = this.params;
     
        if (!ids || !account || account !== this.session.a) {
            this.body = []; return;
        }
        const fields = ids.split('-');
        try {
            let res;
            for(const id of fields) {
                res = yield Tarantool.instance('tarantool').call('notification_read', account, id);
            }
            this.body = toResArray(res);
        } catch (error) {
            console.error(`[reqid ${this.request.header['x-request-id']}] ${this.session.uid} ERRORLOG notifications @${account} ${error.message}`);
            this.body = [];
        }
        return;
    });

    router.post('/notifications/register', koaBody, function *() {
        this.body = '';
        try {
            const params = this.request.body;
            const {csrf, account, webpush_params} = typeof(params) === 'string' ? JSON.parse(params) : params;
            if (!checkCSRF(this, csrf)) return;
            // console.log('-- POST /notifications/register -->', this.session.uid, account, webpush_params);
            if (!account || account !== this.session.a) return;
            if (!webpush_params || !webpush_params.endpoint || !webpush_params.endpoint.match(/^https:\/\/android\.googleapis\.com/)) return;
            if (!webpush_params.keys || !webpush_params.keys.auth) return;
            yield Tarantool.instance('tarantool').call('webpush_subscribe', account, webpush_params);
        } catch (error) {
            console.error(`[reqid ${this.request.header['x-request-id']}] ${this.session.uid} ERRORLOG notifications @${account} ${error.message}`);
        }
    });
}

const status = (ctx, account) =>
    ctx.session.a == null ? 'not logged in' :
    account !== ctx.session.a ? 'wrong account' + ctx.session.a :
    '';
