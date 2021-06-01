import koa_router from 'koa-router';
import koa_body from 'koa-body';
import models from 'db/models';
import findUser from 'db/utils/find_user';
import config from 'config';
import recordWebEvent from 'server/record_web_event';
import {esc, escAttrs} from 'db/models';
import {emailRegex, getRemoteIp, rateLimitReq, checkCSRF} from 'server/utils/misc';
import coBody from 'co-body';
import Tarantool from 'db/tarantool';
import {PublicKey, Signature, hash} from 'golos-classic-js/lib/auth/ecc';
import {api, broadcast} from 'golos-classic-js';
import { getDynamicGlobalProperties } from 'app/utils/APIWrapper'

export default function useGeneralApi(app) {
    const router = koa_router({prefix: '/api/v1'});
    app.use(router.routes());
    const koaBody = koa_body();

    router.get('/healthcheck', function *() {
        this.status = 200;
        this.statusText = 'OK';
        this.body = {status: 200, statusText: 'OK'};
    })

    router.get('/gls-supply', function * () {
        const data = yield api.getDynamicGlobalPropertiesAsync();

        this.status = 200;
        this.statusText = 'OK';
        this.body = data.current_supply.split(' ')[0];
    })

    router.get('/gbg-supply', function * () {
        const data = yield api.getDynamicGlobalPropertiesAsync();

        this.status = 200;
        this.statusText = 'OK';
        this.body = data.current_sbd_supply.split(' ')[0];
    })

    router.post('/accounts', koaBody, function *() {
        if (rateLimitReq(this, this.req)) return;
        const params = this.request.body;
        const account = typeof(params) === 'string' ? JSON.parse(params) : params;
        if (!checkCSRF(this, account.csrf)) return;
        console.log('-- /accounts -->', this.session.uid, this.session.user, account);

        const remote_ip = getRemoteIp(this.req);

        const user_id = this.session.user;
        if (!user_id) { // require user to sign in with identity provider
            this.body = JSON.stringify({error: 'Unauthorized'});
            this.status = 401;
            return;
        }

        try {
            const lock_entity_res = yield Tarantool.instance('tarantool').call('lock_entity', user_id+'');
            if (!lock_entity_res[0][0]) {
                console.log('-- /accounts lock_entity -->', user_id, lock_entity_res[0][0]);
                this.body = JSON.stringify({error: 'Conflict'});
                this.status = 409;
                return;
            }
        } catch (e) {
            console.error('-- /accounts tarantool is not available, fallback to another method', e)
            const rnd_wait_time = Math.random() * 10000;
            console.log('-- /accounts rnd_wait_time -->', rnd_wait_time);
            yield new Promise((resolve) =>
                setTimeout(() => resolve(), rnd_wait_time)
            )
        }

        try {
            const user = yield models.User.findOne(
                {attributes: ['verified', 'waiting_list'], where: {id: user_id}}
            );
            if (!user) {
                this.body = JSON.stringify({error: 'Unauthorized'});
                this.status = 401;
                return;
            }

            // check if user's ip is associated with any bot
            const same_ip_bot = yield models.User.findOne({
                attributes: ['id', 'created_at'],
                where: {remote_ip, bot: true}
            });
            if (same_ip_bot) {
                console.log('-- /accounts same_ip_bot -->', user_id, this.session.uid, remote_ip, user.email);
                this.body = JSON.stringify({error: 'We are sorry, we cannot sign you up at this time because your IP address is associated with bots activity. Please contact t@cyber.fund for more information.'});
                this.status = 401;
                return;
            }

            const existing_account = yield models.Account.findOne({
                attributes: ['id', 'created_at'],
                where: {UserId: user_id, ignored: false},
                order: [ ['id', 'DESC'] ]
            });

            if (existing_account) {
                throw new Error("Only one Golos account per user is allowed in order to prevent abuse");
            }

            const same_ip_account = yield models.Account.findOne(
                {attributes: ['created_at'], where: {remote_ip: esc(remote_ip)}, order: [ ['id', 'DESC'] ]}
            );
            if (same_ip_account) {
                const minutes = (Date.now() - same_ip_account.created_at) / 60000;
                if (minutes < 10) {
                    console.log(`api /accounts: IP rate limit for user ${this.session.uid} #${user_id}, IP ${remote_ip}`);
                    throw new Error('Only one Golos account allowed per IP address every 10 minutes');
                }
            }
            if (user.waiting_list) {
                console.log(`api /accounts: waiting_list user ${this.session.uid} #${user_id}`);
                throw new Error('You are on the waiting list. We will get back to you at the earliest possible opportunity.');
            }

            let json_metadata = '';

            let mid;
            if (account.invite_code && !this.session.soc_id) {
                mid = yield models.Identity.findOne(
                    {attributes: ['id'], where: {UserId: user_id, provider: 'invite_code', verified: false}, order: [ ['id', 'DESC'] ]}
                );
                if (!mid) {
                    console.log(`api /accounts: try to skip use_invite step by user ${this.session.uid} #${user_id}`);
                    throw new Error('Not passed entering use_invite step');
                }
                else {
                  console.log(`api /accounts: found use_invite step for user ${this.session.uid} #${user_id}`)
                }
            } else if (this.session.soc_id && this.session.soc_id_type) {
                mid = yield models.Identity.findOne(
                    {attributes: ['id'], where: {UserId: user_id, provider: 'social-' + this.session.soc_id_type.replace('_id', ''), verified: false}, order: [ ['id', 'DESC'] ]}
                );
                if (!mid) {
                    console.log(`api /accounts: not authorized with social site for user ${this.session.uid} #${user_id}`);
                    throw new Error('Not authorized with social site');
                }
                else {
                  console.log(`api /accounts: is authorized with social site for user ${this.session.uid} #${user_id}`)
                }
                json_metadata = {[this.session.soc_id_type]: this.session.soc_id};
                json_metadata = JSON.stringify(json_metadata);
            } else {
                mid = yield models.Identity.findOne(
                    {attributes: ['id'], where: {UserId: user_id, provider: 'email', verified: true}, order: [ ['id', 'DESC'] ]}
                );
                if (!mid) {
                    console.log(`api /accounts: not confirmed sms for user ${this.session.uid} #${user_id}`);
                    throw new Error('Phone number is not confirmed');
                }
                else {
                  console.log(`api /accounts: is confirmed sms for user ${this.session.uid} #${user_id}`)
                }
            }

            // store email
            let email = account.email || '';
            const parsed_email = email.match(/^.+\@.*?([\w\d-]+\.\w+)$/);
            if (!parsed_email || parsed_email.length < 2) email = null;

            if (email) {
                yield models.Identity.create({
                    provider: 'email',
                    UserId: user_id,
                    uid: this.session.uid,
                    email,
                    verified: false
                });
            }

            const [fee_value, fee_currency] = config.get('registrar.fee').split(' ');
            const delegation = config.get('registrar.delegation')

            let fee = parseFloat(fee_value);
            let max_referral_interest_rate;
            let max_referral_term_sec;
            let max_referral_break_fee;
            try {
                const chain_properties = yield api.getChainPropertiesAsync();
                const chain_fee = parseFloat(chain_properties.account_creation_fee);
                if (chain_fee && chain_fee > fee) {
                    if (fee / chain_fee > 0.5) { // just a sanity check - chain fee shouldn't be a way larger
                        console.log('-- /accounts warning: chain_fee is larger than config fee -->', this.session.uid, fee, chain_fee);
                        fee = chain_fee;
                    }
                }
                max_referral_interest_rate = chain_properties.max_referral_interest_rate;
                max_referral_term_sec = chain_properties.max_referral_term_sec;
                max_referral_break_fee = chain_properties.max_referral_break_fee;
            } catch (error) {
                console.error('Error in /accounts get_chain_properties', error);
            }

            const dgp = yield api.getDynamicGlobalPropertiesAsync();

            let extensions = [];
            if (!account.invite_code && account.referrer)
            {
                extensions = 
                [[
                    0, {
                        referrer: account.referrer,
                        interest_rate: max_referral_interest_rate,
                        end_date: new Date(Date.parse(dgp.time) + max_referral_term_sec*1000).toISOString().split(".")[0],
                        break_fee: max_referral_break_fee
                    }
                ]];
            }

            yield createAccount({
                signingKey: config.get('registrar.signing_key'),
                fee: `${fee.toFixed(3)} ${fee_currency}`,
                creator: config.registrar.account,
                new_account_name: account.name,
                owner: account.owner_key,
                active: account.active_key,
                posting: account.posting_key,
                memo: account.memo_key,
                delegation,
                json_metadata,
                extensions,
                invite_secret: account.invite_code ? account.invite_code : ''
            });

            if (account.invite_code || this.session.soc_id) {
                yield mid.update({ verified: true });
            }

            console.log('-- create_account_with_keys created -->', this.session.uid, account.name, user_id, account.owner_key);

            models.Account.create(escAttrs({
                UserId: user_id,
                name: account.name,
                owner_key: account.owner_key,
                active_key: account.active_key,
                posting_key: account.posting_key,
                memo_key: account.memo_key,
                remote_ip,
                referrer: this.session.r
            })).catch(error => {
                console.error('!!! Can\'t create account model in /accounts api', this.session.uid, error);
            });
            this.body = JSON.stringify({status: 'ok'});
        } catch (error) {
            console.error('Error in /accounts api call', this.session.uid, error.toString());
            this.body = JSON.stringify({error: error.message});
            this.status = 500;
        } finally {
            // console.log('-- /accounts unlock_entity -->', user_id);
            try { yield Tarantool.instance('tarantool').call('unlock_entity', user_id + ''); } catch(e) {/* ram lock */}
        }
        recordWebEvent(this, 'api/accounts', account ? account.name : 'n/a');
    });

    router.post('/update_email', koaBody, function *() {
        if (rateLimitReq(this, this.req)) return;
        const params = this.request.body;
        const {csrf, email} = typeof(params) === 'string' ? JSON.parse(params) : params;
        if (!checkCSRF(this, csrf)) return;
        console.log('-- /update_email -->', this.session.uid, email);
        try {
            if (!emailRegex.test(email.toLowerCase())) throw new Error('not valid email: ' + email);
            // TODO: limit by 1/min/ip
            let user = yield findUser({user_id: this.session.user, email: esc(email), uid: this.session.uid});
            if (user) {
                user = yield models.User.update({email: esc(email), waiting_list: true}, {where: {id: user.id}});
            } else {
                user = yield models.User.create({email: esc(email), waiting_list: true});
            }
            this.session.user = user.id;
            this.body = JSON.stringify({status: 'ok'});
        } catch (error) {
            console.error('Error in /update_email api call', this.session.uid, error);
            this.body = JSON.stringify({error: error.message});
            this.status = 500;
        }
        recordWebEvent(this, 'api/update_email', email);
    });

    router.post('/login_account', koaBody, function *() {
        if (rateLimitReq(this, this.req)) return;
        const params = this.request.body;
        const {csrf, account, signatures} = typeof(params) === 'string' ? JSON.parse(params) : params;
        if (!checkCSRF(this, csrf)) return;
        console.log('-- /login_account -->', this.session.uid, account);
        try {
            const db_account = yield models.Account.findOne(
                {attributes: ['UserId'], where: {name: esc(account)}, logging: false}
            );
            if (db_account) this.session.user = db_account.UserId;

            let body = { status: 'ok' }
            if(signatures) {
                if(!this.session.login_challenge) {
                    console.error('/login_account missing this.session.login_challenge');
                } else {
                    const [chainAccount] = yield api.getAccountsAsync([account])
                    if(!chainAccount) {
                        console.error('/login_account missing blockchain account', account);
                    } else {
                        const auth = {posting: false}
                        const bufSha = hash.sha256(JSON.stringify({token: this.session.login_challenge}, null, 0))
                        const verify = (type, sigHex, pubkey, weight, weight_threshold) => {
                            if(!sigHex) return
                            if(weight !== 1 || weight_threshold !== 1) {
                                console.error(`/login_account login_challenge unsupported ${type} auth configuration: ${account}`);
                            } else {
                                const sig = parseSig(sigHex)
                                const public_key = PublicKey.fromString(pubkey)
                                const verified = sig.verifyHash(bufSha, public_key)
                                if (!verified) {
                                    console.error('/login_account verification failed', this.session.uid, account, pubkey)
                                }
                                auth[type] = verified
                            }
                        }
                        const {posting: {key_auths: [[posting_pubkey, weight]], weight_threshold}} = chainAccount
                        verify('posting', signatures.posting, posting_pubkey, weight, weight_threshold)
                        if (auth.posting) {
                          this.session.a = account;
                            if (config.has('tarantool') && config.has('tarantool.host')) {
                                try {
                                    const res = yield Tarantool.instance('tarantool').call('get_guid', account);
                                    const [acc, guid] = res[0][0];
                                    body = Object.assign(body, { guid })
                                } catch (e) {}
                            }
                        }
                    }
                }
            }

            this.body = JSON.stringify(body);
            const remote_ip = getRemoteIp(this.req);
        } catch (error) {
            console.error('Error in /login_account api call', this.session.uid, error.message);
            this.body = JSON.stringify({error: error.message});
            this.status = 500;
        }
        recordWebEvent(this, 'api/login_account', account);
    });

    router.post('/logout_account', koaBody, function *() {
        // if (rateLimitReq(this, this.req)) return; - logout maybe immediately followed with login_attempt event
        const params = this.request.body;
        const {csrf} = typeof(params) === 'string' ? JSON.parse(params) : params;
        if (!checkCSRF(this, csrf)) return;
        console.log('-- /logout_account -->', this.session.uid);
        try {
          this.session.a = this.session.user = this.session.uid = null;
            this.body = JSON.stringify({status: 'ok'});
        } catch (error) {
            console.error('Error in /logout_account api call', this.session.uid, error);
            this.body = JSON.stringify({error: error.message});
            this.status = 500;
        }
    });

    router.post('/record_event', koaBody, function *() {
        if (rateLimitReq(this, this.req)) return;
        try {
            const params = this.request.body;
            const {csrf, type, value} = typeof(params) === 'string' ? JSON.parse(params) : params;
            if (!checkCSRF(this, csrf)) return;
            console.log('-- /record_event -->', this.session.uid, type, value);
            const str_value = typeof value === 'string' ? value : JSON.stringify(value);
            recordWebEvent(this, type, str_value);
            this.body = JSON.stringify({status: 'ok'});
        } catch (error) {
            console.error('Error in /record_event api call', error.message);
            this.body = JSON.stringify({error: error.message});
            this.status = 500;
        }
    });

    router.post('/csp_violation', function *() {
        if (rateLimitReq(this, this.req)) return;
        const params = yield coBody.json(this);
        console.log('-- /csp_violation -->', this.req.headers['user-agent'], params);
        this.body = '';
    });

    router.post('/page_view', koaBody, function *() {
        const params = this.request.body;
        const {csrf, page, ref, posts} = typeof(params) === 'string' ? JSON.parse(params) : params;
        if (!checkCSRF(this, csrf)) return;
        if (page.match(/\/feed$/)) {
            this.body = JSON.stringify({views: 0});
            return;
        }

        recordWebEvent(this, 'PageView', JSON.stringify(posts));
        const remote_ip = getRemoteIp(this.req);
        try {
            let views = 1, unique = true;
            if (config.has('tarantool') && config.has('tarantool.host')) {
                try {
                    const res = yield Tarantool.instance('tarantool').call('page_view', page, remote_ip, this.session.uid, ref);
                    unique = res[0][0];
                } catch (e) {}
            }
            const page_model = yield models.Page.findOne(
                {attributes: ['id', 'views'], where: {permlink: esc(page)}, logging: false}
            );
            if (unique) {
                if (page_model) {
                    views = page_model.views + 1;
                    yield yield models.Page.update({views}, {where: {id: page_model.id}, logging: false});
                } else {
                    yield models.Page.create(escAttrs({permlink: page, views}), {logging: false});
                }
            } else {
                if (page_model) views = page_model.views;
            }
            this.body = JSON.stringify({views});
        } catch (error) {
            console.error('Error in /page_view api call', this.session.uid, error.message);
            this.body = JSON.stringify({error: error.message});
            this.status = 500;
        }
    });
}

/**
 @arg signingKey {string|PrivateKey} - WIF or PrivateKey object
 */
export function* createAccount({
    signingKey, fee, creator, new_account_name, json_metadata = '',
    owner, active, posting, memo, delegation, extensions, invite_secret = ''
}) {
    let operations = [[(invite_secret == '' ? 'account_create_with_delegation' : 'account_create_with_invite'), {
        fee, creator, new_account_name, json_metadata,
        owner: {weight_threshold: 1, account_auths: [], key_auths: [[owner, 1]]},
        active: {weight_threshold: 1, account_auths: [], key_auths: [[active, 1]]},
        posting: {weight_threshold: 1, account_auths: [], key_auths: [[posting, 1]]},
        memo_key: memo, extensions: extensions
    }]]
    if (invite_secret != '') {
        operations[0][1].invite_secret = invite_secret;
    } else {
        operations[0][1].delegation = delegation;
    }
    yield broadcast.sendAsync({
        extensions: [],
        operations
    }, [signingKey])
}
const parseSig = hexSig => {try {return Signature.fromHex(hexSig)} catch(e) {return null}}
