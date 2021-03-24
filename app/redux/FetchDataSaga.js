import { call, put, select, fork, cancelled, takeLatest, takeEvery } from 'redux-saga/effects';
import { getPinnedPosts, getMutedInNew } from 'app/utils/NormalizeProfile'
import {loadFollows, fetchFollowCount} from 'app/redux/FollowSaga';
import {getContent} from 'app/redux/SagaShared';
import GlobalReducer from './GlobalReducer';
import constants from './constants';
import { reveseTag } from 'app/utils/tags';
import { CATEGORIES, DEBT_TOKEN_SHORT, LIQUID_TICKER, DEFAULT_CURRENCY, IGNORE_TAGS, PUBLIC_API, SELECT_TAGS_KEY } from 'app/client_config';
import cookie from "react-cookie";
import {config, api} from 'golos-classic-js';

export function* fetchDataWatches () {
    yield fork(watchLocationChange);
    yield fork(watchDataRequests);
    yield fork(watchFetchJsonRequests);
    yield fork(watchFetchState);
    yield fork(watchGetContent);
    yield fork(watchFetchExchangeRates);
    yield fork(watchFetchVestingDelegations);
}

export function* watchGetContent() {
    yield takeEvery('GET_CONTENT', getContentCaller);
}

export function* getContentCaller(action) {
    yield getContent(action.payload);
}

export function* watchLocationChange() {
    yield takeLatest('@@router/LOCATION_CHANGE', fetchState);
}

export function* watchFetchState() {
    yield takeLatest('FETCH_STATE', fetchState);
}

let is_initial_state = true;
export function* fetchState(location_change_action) {
    const {pathname} = location_change_action.payload;
    const m = pathname.match(/^\/@([a-z0-9\.-]+)/)
    if(m && m.length === 2) {
        const username = m[1]
        yield fork(fetchFollowCount, username)
        yield fork(loadFollows, "getFollowersAsync", username, 'blog')
        yield fork(loadFollows, "getFollowingAsync", username, 'blog')
        yield fork(loadFollows, "getFollowingAsync", username, 'ignore')
    }

    // `ignore_fetch` case should only trigger on initial page load. No need to call
    // fetchState immediately after loading fresh state from the server. Details: #593
    const server_location = yield select(state => state.offchain.get('server_location'))
    //const ignore_fetch = (pathname === server_location && is_initial_state)
    is_initial_state = false
    //if(ignore_fetch) return

    let url = `${pathname}`
    url = url.split('?')[0]
    if (url === '/') url = 'trending'
    // Replace these URLs with /transfers for UserProfile to resolve data correctly
    if (url.indexOf("/curation-rewards") !== -1) url = url.replace("/curation-rewards", "/transfers")
    if (url.indexOf("/author-rewards") !== -1) url = url.replace("/author-rewards", "/transfers")
    if (url.indexOf("/donates-from") !== -1) url = url.replace("/donates-from", "/transfers")
    if (url.indexOf("/donates-to") !== -1) url = url.replace("/donates-to", "/transfers")

    yield put({type: 'FETCH_DATA_BEGIN'})
    try {
        if (!url || typeof url !== 'string' || !url.length || url === '/') url = 'trending'
        if (url[0] === '/') url = url.substr(1)
        const parts = url.split('/')
        const tag = typeof parts[1] !== "undefined" ? parts[1] : ''

        const state = {}
        state.current_route = location
        state.content = {}
        state.prev_posts = []
        state.assets = {}
        state.worker_requests = {}
        state.accounts = {}

        let accounts = new Set()

        if (parts[0][0] === '@') {
            const uname = parts[0].substr(1)
            const [ account ] = yield call([api, api.getAccountsAsync], [uname])
            state.accounts[uname] = account
            
            if (account) {
                state.accounts[uname].tags_usage = yield call([api, api.getTagsUsedByAuthorAsync], uname)
                state.accounts[uname].guest_bloggers = yield call([api, api.getBlogAuthorsAsync], uname)

                switch (parts[1]) {
                    case 'transfers':
                        const history = yield call([api, api.getAccountHistoryAsync], uname, -1, 1000, {filter_ops: ['producer_reward']})
                        account.transfer_history = []
                        account.other_history = []

                        state.cprops = yield call([api, api.getChainPropertiesAsync])
                        
                        history.forEach(operation => {
                            switch (operation[1].op[0]) {
                                case 'claim':
                                case 'donate':
                                case 'transfer':
                                case 'author_reward':
                                case 'curation_reward':
                                case 'transfer_to_tip':
                                case 'transfer_from_tip':
                                case 'transfer_to_vesting':
                                case 'withdraw_vesting':
                                case 'asset_issue':
                                case 'invite':
                                case 'invite_claim':
                                case 'transfer_to_savings':
                                case 'transfer_from_savings':
                                case 'worker_reward':
                                case 'internal_transfer':
                                    state.accounts[uname].transfer_history.push(operation)
                                break

                                default:
                                    state.accounts[uname].other_history.push(operation)
                            }
                        })
                    break

                    case 'create-asset':
                    case 'assets':
                        state.assets = (yield call([api, api.getAccountsBalancesAsync], [uname]))[0]
                        const my_assets = yield call([api, api.getAssetsAsync], '', [], '', 5000)
                        my_assets.forEach(ma => {
                            const sym = ma.supply.split(' ')[1]
                            const precision = ma.supply.split(' ')[0].split('.')[1].length

                            if (sym in state.assets) {
                                state.assets[sym].my = true
                            } else {
                                state.assets[sym] = {
                                    balance: '0.' + '0'.repeat(precision) + ' ' + sym,
                                    tip_balance: '0.' + '0'.repeat(precision) + ' ' + sym
                                }
                            }

                            state.assets[sym] = {...state.assets[sym], ...ma, precision}

                            if (ma.creator == uname) {
                                state.assets[sym].my = true
                            }
                        })

                        state.cprops = yield call([api, api.getChainPropertiesAsync])
                    break

                    case 'invites':
                        state.cprops = yield call([api, api.getChainPropertiesAsync])
                    break

                    case 'recent-replies':
                        const replies = yield call([api, api.getRepliesByLastUpdateAsync], uname, '', 50, constants.DEFAULT_VOTE_LIMIT, 0, ['fm-'])
                        state.accounts[uname].recent_replies = []

                        replies.forEach(reply => {
                            const link = `${reply.author}/${reply.permlink}`
                            state.content[link] = reply
                            state.accounts[uname].recent_replies.push(link)
                        })
                    break

                    case 'posts':
                    case 'comments':
                        const comments = yield call([api, api.getDiscussionsByCommentsAsync], { start_author: uname, limit: 20, filter_tag_masks: ['fm-'] })
                        state.accounts[uname].comments = []

                        comments.forEach(comment => {
                            const link = `${comment.author}/${comment.permlink}`
                            state.content[link] = comment
                            state.accounts[uname].comments.push(link)
                        })
                    break

                    case 'feed':
                        const feedEntries = yield call([api, api.getFeedEntriesAsync], uname, 0, 20, ['fm-'])
                        state.accounts[uname].feed = []

                        for (let key in feedEntries) {
                            const { author, permlink } = feedEntries[key]
                            const link = `${author}/${permlink}`
                            state.accounts[uname].feed.push(link)
                            state.content[link] = yield call([api, api.getContentAsync], author, permlink, constants.DEFAULT_VOTE_LIMIT)
                            
                            if (feedEntries[key].reblog_by.length > 0) {
                                state.content[link].first_reblogged_by = feedEntries[key].reblog_by[0]
                                state.content[link].reblogged_by = feedEntries[key].reblog_by
                                state.content[link].first_reblogged_on = feedEntries[key].reblog_on
                            }
                        }
                    break

                    case 'blog':
                      default:
                      const blogEntries = yield call([api, api.getBlogEntriesAsync], uname, 0, 20, ['fm-'])
                      state.accounts[uname].blog = []

                      let pinnedPosts = getPinnedPosts(account)
                      blogEntries.unshift(...pinnedPosts)

                        for (let key in blogEntries) {
                            const { author, permlink } = blogEntries[key]
                            const link = `${author}/${permlink}`

                            state.content[link] = yield call([api, api.getContentAsync], author, permlink, constants.DEFAULT_VOTE_LIMIT)
                            state.accounts[uname].blog.push(link)
                        
                            if (blogEntries[key].reblog_on !== '1970-01-01T00:00:00') {
                                state.content[link].first_reblogged_on = blogEntries[key].reblog_on
                            }
                        }
                    break
                }
            }

        } else if (parts.length === 3 && parts[1].length > 0 && parts[1][0] == '@') {
            const account = parts[1].substr(1)

            // Fetch for ignored follow for hide comments
            yield fork(loadFollows, "getFollowingAsync", account, 'ignore')

            const category = parts[0]
            const permlink = parts[2]
    
            const curl = `${account}/${permlink}`
            state.content[curl] = yield call([api, api.getContentAsync], account, permlink, constants.DEFAULT_VOTE_LIMIT)
            accounts.add(account)

            const replies =  yield call([api, api.getAllContentRepliesAsync], account, permlink, constants.DEFAULT_VOTE_LIMIT, 0, [], [], true)
            
            for (let key in replies) {
                let reply = replies[key]
                const link = `${reply.author}/${reply.permlink}`

                accounts.add(reply.author)
 
                state.content[link] = reply
                if (reply.parent_permlink === permlink) {
                    state.content[curl].replies.push(link)
                }
                state.content[link].donate_list = [];
                if (state.content[link].donates != '0.000 GOLOS') {
                    const donates =  yield call([api, api.getDonatesAsync], false, {author: reply.author, permlink: reply.permlink}, '', '', 20, 0, true)
                    state.content[link].donate_list = donates;
                }
                state.content[link].donate_uia_list = [];
                if (state.content[link].donates_uia != 0) {
                    state.content[link].donate_uia_list = yield call([api, api.getDonatesAsync], true, {author: reply.author, permlink: reply.permlink}, '', '', 20, 0, true)
                }
                state.content[link].confetti_active = false
            }

            state.content[curl].donate_list = [];
            if (state.content[curl].donates != '0.000 GOLOS') {
                const donates = yield call([api, api.getDonatesAsync], false, {author: account, permlink: permlink}, '', '', 20, 0, true)
                state.content[curl].donate_list = donates;
            }
            state.content[curl].donate_uia_list = [];
            if (state.content[curl].donates_uia != 0) {
                state.content[curl].donate_uia_list = yield call([api, api.getDonatesAsync], true, {author: account, permlink: permlink}, '', '', 20, 0, true)
            }
            state.content[curl].confetti_active = false

            let args = { truncate_body: 128, select_categories: [category], filter_tag_masks: ['fm-'] };
            let prev_posts = yield call([api, api[PUBLIC_API.created]], {limit: 4, start_author: account, start_permlink: permlink, select_authors: [account], ...args});
            prev_posts = prev_posts.slice(1);
            let p_ids = [];
            for (let p of prev_posts) {
                p_ids.push(p.author + p.permlink);
            }
            if (prev_posts.length < 3) {
                let trend_posts = yield call([api, api[PUBLIC_API.trending]], {limit: 4, ...args});
                for (let p of trend_posts) {
                    if (p.author === account && p.permlink === permlink) continue;
                    if (p_ids.includes(p.author + p.permlink)) continue;
                    prev_posts.push(p);
                    p_ids.push(p.author + p.permlink);
                }
            }
            if (prev_posts.length < 3) {
                delete args.select_categories;
                let author_posts = yield call([api, api[PUBLIC_API.author]], {limit: 4, select_authors: [account], ...args});
                for (let p of author_posts) {
                    if (p.author === account && p.permlink === permlink) continue;
                    if (p_ids.includes(p.author + p.permlink)) continue;
                    prev_posts.push(p);
                }
            }
            state.prev_posts = prev_posts.slice(0, 3);

            if (localStorage.getItem('invite')) {
                state.assets = (yield call([api, api.getAccountsBalances], [localStorage.getItem('invite')]))[0]
            }
        } else if (parts[0] === 'witnesses' || parts[0] === '~witnesses') {
            state.witnesses = {};
            const witnesses =  yield call([api, api.getWitnessesByVoteAsync], '', 100)

            witnesses.forEach( witness => {
                state.witnesses[witness.owner] = witness
            })

        }  else if (parts[0] === 'workers') {
            accounts.add('workers');
            state.cprops = yield call([api, api.getChainPropertiesAsync])

            if (parts.length === 4) {
                const author = parts[2].substr(1);
                const permlink = parts[3];
                const url = `${author}/${permlink}`;
                const query = {
                  limit: 1,
                  start_author: author,
                  start_permlink: permlink
                };
                const [ wr ] = yield call([api, api.getWorkerRequestsAsync], query, 'by_created', true);
                state.worker_requests[url] = wr;

                const votes = yield call([api, api.getWorkerRequestVotesAsync], author, permlink, '', 50);
                state.worker_requests[url].votes = votes;

                const voter = localStorage.getItem('invite');
                if (voter) {
                    const [ myVote ] = yield call([api, api.getWorkerRequestVotesAsync], author, permlink, voter, 1);
                    state.worker_requests[url].myVote = (myVote && myVote.voter == voter) ? myVote : null
                }
            }
        } else if (Object.keys(PUBLIC_API).includes(parts[0])) {

            yield call(fetchData, {payload: { order: parts[0], category : tag }})

        } else if (parts[0] == 'tags') {
            const tags = {}
            const trending_tags = yield call([api, api.getTrendingTagsAsync], '', 250)
            trending_tags.forEach (tag => tags[tag.name] = tag)
            state.tags = tags
        } else if (parts[0] == 'msgs') {
            const { ws_connection_msgs } = $STM_Config;
            if (ws_connection_msgs)
                config.set('websocket', ws_connection_msgs);
            state.contacts = [];
            state.messages = [];
            state.messages_update = '0';
            if (localStorage.getItem('invite')) {
                accounts.add(localStorage.getItem('invite'));

                console.time('fcon');
                state.contacts = yield call([api, api.getContactsAsync], localStorage.getItem('invite'), 'unknown', 100, 0);
                console.timeEnd('fcon');

                if (parts[1]) {
                    const to = parts[1].replace('@', '');
                    accounts.add(to);

                    console.time('fmsg');
                    state.messages = yield call([api, api.getThreadAsync], localStorage.getItem('invite'), to, {});
                    if (state.messages.length) {
                        state.messages_update = state.messages[state.messages.length - 1].nonce;
                    }
                    console.timeEnd('fmsg');

                }
            }
            for (let contact of state.contacts) {
                accounts.add(contact.contact);
            }
        }

        if (accounts.size > 0) {
                    console.time('accs');
            const acc = yield call([api, api.getAccountsAsync], Array.from(accounts))
                    console.timeEnd('accs');
            for (let i in acc) {
                state.accounts[ acc[i].name ] = acc[i]
            }
        }

        yield put(GlobalReducer.actions.receiveState(state))
        yield put({type: 'FETCH_DATA_END'})
    } catch (error) {
        console.error('~~ Saga fetchState error ~~>', url, error);
        yield put({type: 'global/FETCHING_STATE', payload: false});
        yield put({type: 'global/CHAIN_API_ERROR', error: error.message});

        if (!(yield cancelled())) {
            yield put({type: 'FETCH_DATA_END'})
        }
    }
}

export function* watchDataRequests() {
    yield takeLatest('REQUEST_DATA', fetchData);
}

export function* fetchData(action) {
    const {
        order,
        author,
        permlink,
        accountname,
        keys
    } = action.payload;
    let { category } = action.payload;

    if( !category ) category = "";
    category = category.toLowerCase();

    let call_name, args;
    args = [
        {
            limit: constants.FETCH_DATA_BATCH_SIZE,
            truncate_body: constants.FETCH_DATA_TRUNCATE_BODY,
            start_author: author,
            start_permlink: permlink,
            filter_tag_masks: ['fm-']
        }
    ];
    if (category.length && (!category.startsWith('tag-') || category.length > 4)) {
        if (category.startsWith('tag-')) {
            let tag_raw = category.slice(4);
            const reversed = reveseTag(tag_raw)
            reversed
                ? args[0].select_tags = [tag_raw, reversed]
                : args[0].select_tags = [tag_raw]
        } else {
            const reversed = reveseTag(category)
            reversed
                ? args[0].select_categories = [category, reversed]
                : args[0].select_categories = [category]
        }
    } else {
        let select_tags = cookie.load(SELECT_TAGS_KEY);
        if (select_tags && select_tags.length) {
            let selectTags = []
            
            select_tags.forEach( t => {
                const reversed = reveseTag(t)
                reversed
                ? selectTags = [ ...selectTags, t, reversed ]
                : selectTags = [ ...selectTags, t, ] 
                
            })
            args[0].select_categories = selectTags;
            category = select_tags.sort().join('/')
        } else {
            let selectTags = []
            
            CATEGORIES.forEach( t => {
                const reversed = reveseTag(t)
                reversed
                ? selectTags = [ ...selectTags, t, reversed ]
                : selectTags = [ ...selectTags, t, ] 
                
            })
            args[0].select_categories = selectTags;
            args[0].filter_tags = IGNORE_TAGS
        }
    }

    if (order == 'created' && localStorage.getItem('invite')) {
        const [ loader ] = yield call([api, api.getAccountsAsync], [localStorage.getItem('invite')])
        const mutedInNew = getMutedInNew(loader);
        args[0].filter_authors = mutedInNew;
    }

    yield put({ type: 'global/FETCHING_DATA', payload: { order, category } });

    if (order === 'trending') {
        call_name = PUBLIC_API.trending;
    } else if (order === 'promoted') {
        call_name = PUBLIC_API.promoted;
    } else if( order === 'active' /*|| order === 'updated'*/) {
        call_name = PUBLIC_API.active;
    } else if( order === 'cashout' ) {
        call_name = PUBLIC_API.cashout;
    } else if( order === 'payout' ) {
        call_name = PUBLIC_API.payout;
    } else if( order === 'created' || order === 'recent' ) {
        call_name = PUBLIC_API.created;
    } else if( order === 'responses' ) {
        call_name = PUBLIC_API.responses;
    } else if( order === 'donates' ) {
        call_name = PUBLIC_API.donates;
    } else if( order === 'votes' ) {
        call_name = PUBLIC_API.votes;
    } else if( order === 'hot' ) {
        call_name = PUBLIC_API.hot;
    } else if( order === 'by_feed' ) {
        call_name = 'getDiscussionsByFeedAsync';
        delete args[0].select_tags;
        delete args[0].select_categories;
        args[0].select_authors = [accountname];
    } else if (order === 'by_author') {
        call_name = 'getDiscussionsByBlogAsync';
        delete args[0].select_tags;
        delete args[0].select_categories;
        args[0].select_authors = [accountname];
    } else if (order === 'by_comments') {
        delete args[0].select_tags;
        delete args[0].select_categories;
        call_name = 'getDiscussionsByCommentsAsync';
    } else if( order === 'by_replies' ) {
        call_name = 'getRepliesByLastUpdateAsync';
        args = [author, permlink, constants.FETCH_DATA_BATCH_SIZE, constants.DEFAULT_VOTE_LIMIT];
    } else {
        call_name = PUBLIC_API.active;
    }
    yield put({ type: 'FETCH_DATA_BEGIN' });

    try {
        let posts = []

        const data = yield call([api, api[call_name]], ...args);

        if (['created', 'responses', 'hot', 'trending'].includes(order) && !args[0].start_author) {
          // Add top 3 from promo to tranding and 1 to hot, created
          args[0].limit = order == 'trending' ? 3 : 1

          const promo_posts = yield call([api, api[PUBLIC_API.promoted]], ...args);
          posts = posts.concat(promo_posts)
        }

        data.forEach(post => {
          posts.push(post)
        })

        yield put(
            GlobalReducer.actions.receiveData({
                data: posts,
                order,
                category,
                author,
                permlink,
                accountname,
                keys,
            })
        );


        yield put({ type: 'FETCH_DATA_END' });
    } catch (error) {
        console.error('~~ Saga fetchData error ~~>', call_name, args, error);
        yield put({ type: 'global/CHAIN_API_ERROR', error: error.message });

        if (!(yield cancelled())) {
            yield put({ type: 'FETCH_DATA_END' });
        }
    }
}

export function* watchFetchJsonRequests() {
    yield takeEvery('global/FETCH_JSON', fetchJson);
}

/**
    @arg {string} id unique key for result global['fetchJson_' + id]
    @arg {string} url
    @arg {object} body (for JSON.stringify)
*/
function* fetchJson({payload: {id, url, body, successCallback, skipLoading = false}}) {
    try {
        const payload = {
            method: body ? 'POST' : 'GET',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json'
            },
            body: body ? JSON.stringify(body) : undefined
        }
        yield put({type: 'global/FETCHING_JSON', payload: true});
        let result = yield skipLoading ? fetch(url, payload) : call(fetch, url, payload)
        result = yield result.json()
        if (successCallback) result = successCallback(result)
        yield put({type: 'global/FETCHING_JSON', payload: false});
        yield put(GlobalReducer.actions.fetchJsonResult({id, result}))
    } catch(error) {
        console.error('fetchJson', error)
        yield put({type: 'global/FETCHING_JSON', payload: false});
        yield put(GlobalReducer.actions.fetchJsonResult({id, error}))
    }
}

export function* watchFetchExchangeRates() {
    yield takeEvery('global/FETCH_EXCHANGE_RATES', fetchExchangeRates);
}

export function* fetchExchangeRates() {
  const fourHours = 1000 * 60 * 60 * 4;

  try {
    const created = localStorage.getItem('xchange.created') || 0;

    let pickedCurrency = localStorage.getItem('xchange.picked') || DEFAULT_CURRENCY;
    if (pickedCurrency.localeCompare(DEBT_TOKEN_SHORT) == 0) {
        // pickedCurrency = DEFAULT_CURRENCY;
        storeExchangeValues(1, 1, 1, DEBT_TOKEN_SHORT); // For GBG currency on site #687
        return;
    }
    if (pickedCurrency.localeCompare(LIQUID_TICKER) == 0) { // For Golos currency on site #687
        const feedPrice = yield call([api, api.getCurrentMedianHistoryPriceAsync]);
        let pricePerGolos = feedPrice.base.split(' ')[0] / parseFloat(parseFloat(feedPrice.quote.split(' ')[0] ));
        storeExchangeValues(1, 1, pricePerGolos, pickedCurrency);
        return;
    }
    if (Date.now() - created < fourHours) {
      return;
    }
    // xchange rates are outdated or not exists
    console.log('xChange rates are outdated or not exists, fetching...')

    yield put({type: 'global/FETCHING_JSON', payload: true});

    let result = yield call(fetch, '/api/v1/rates/');
    result = yield result.json();

    if (result.error) {
      console.log('~~ Saga fetchExchangeRates error ~~>', '[0] The result is undefined.');
      storeExchangeValues();
      yield put({type: 'global/FETCHING_XCHANGE', payload: false});
      return;
    }
    if (
      typeof result === 'object' &&
      typeof result.rates === 'object' &&
      typeof result.rates.XAU === 'number' &&
      typeof result.rates[pickedCurrency] === 'number'
    ) {
      // store result into localstorage
      storeExchangeValues(Date.now(), 1/result.rates.XAU, result.rates[pickedCurrency], pickedCurrency);
    }
    else {
      console.log('~~ Saga fetchExchangeRates error ~~>', 'The result is undefined.');
      storeExchangeValues();
    }
    yield put({type: 'global/FETCHING_XCHANGE', payload: false});
  }
  catch(error) {
    // set default values
    storeExchangeValues();
    console.error('~~ Saga fetchExchangeRates error ~~>', error);
    yield put({type: 'global/FETCHING_XCHANGE', payload: false});
  }
}

function storeExchangeValues(created, gold, pair, picked) {
  localStorage.setItem('xchange.created', created || 0);
  localStorage.setItem('xchange.gold', gold || 1);
  localStorage.setItem('xchange.pair', pair || 1);
  localStorage.setItem('xchange.picked', picked || DEBT_TOKEN_SHORT);
}

export function* watchFetchVestingDelegations() {
    yield takeLatest('global/FETCH_VESTING_DELEGATIONS', fetchVestingDelegations)
}

export function* fetchVestingDelegations({ payload: { account, type } }) {
    const r = yield call([ api, api.getVestingDelegationsAsync ], account, '', 100, type)

    const vesting_delegations = {}
    for (let v in r) {
        vesting_delegations[ type === 'delegated' ? r[v].delegatee : r[v].delegator ] = r[v]
    }

    yield put(GlobalReducer.actions.receiveAccountVestingDelegations({ account, type, vesting_delegations }))
}
