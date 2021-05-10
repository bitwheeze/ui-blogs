import { fromJS } from 'immutable'
import { fork, call, put, select, takeEvery } from 'redux-saga/effects';
import g from 'app/redux/GlobalReducer'
import constants from './constants';
import { api } from 'golos-classic-js';

export function* sharedWatches() {
    yield fork(watchTransactionErrors)
}   

export function* getAccount(username, force = false) {
    let account = yield select(state => state.global.get('accounts').get(username))
    if (force || !account) {
        [account] = yield call([api, api.getAccountsAsync], [username])
        if(account) {
            account = fromJS(account)
            yield put(g.actions.receiveAccount({account}))
        }
    }
    return account
}

export function* watchTransactionErrors() {
    yield takeEvery('transaction/ERROR', showTransactionErrorNotification);
}

function* showTransactionErrorNotification() {
    const errors = yield select(state => state.transaction.get('errors'));

    if (errors) {
        for (const [key, message] of errors) {
            if (message !== 'Duplicate transaction check failed')
                yield put({ type: 'ADD_NOTIFICATION', payload: { key, message } });
            yield put({ type: 'transaction/DELETE_ERROR', payload: { key } });
        }
    }
}

export function* getContent({author, permlink, resolve, reject}) {
    const content = yield call([api, api.getContentAsync], author, permlink, constants.DEFAULT_VOTE_LIMIT);
    yield put(g.actions.receiveContent({content}))
    if (resolve && content) {
        resolve(content);
    } else if (reject && !content) {
        reject();
    }
}

export function* getWorkerRequest({author, permlink, voter}) {
    const query = {
        limit: 1,
        start_author: author,
        start_permlink: permlink
    };
    const [ wr ] = yield call([api, api.getWorkerRequestsAsync], query, 'by_created', true);
    if (wr) {
        const votes = yield call([api, api.getWorkerRequestVotesAsync], author, permlink, '', 50);
        wr.votes = votes;

        if (voter) {
            const [ myVote ] = yield call([api, api.getWorkerRequestVotesAsync], author, permlink, voter, 1);
            wr.myVote = (myVote && myVote.voter == voter) ? myVote : null
        }
        yield put(g.actions.receiveWorkerRequest({wr}))
    }
}
