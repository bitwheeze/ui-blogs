import React from 'react';
import {connect} from 'react-redux';
import SvgImage from 'app/components/elements/SvgImage';
import tt from 'counterpart';
import { formatCoins } from 'app/utils/FormatCoins';
import { APP_DOMAIN } from 'app/client_config';
import { authRegisterUrl, } from 'app/utils/AuthApiClient';

class SignUp extends React.Component {
    constructor() {
        super();
        this.state = {waiting_list: false};
    }
    render() {
        const APP_NAME = tt('g.APP_NAME');
        const VESTING_TOKEN =  tt('token_names.VESTING_TOKEN')

        return <div className="SignUp">
            <div className="row">
                <div className="column">
                    <h3>{tt("g.sign_up")}</h3>
                    <p>
                        {tt("g.personal_info_will_be_private")}
                        {' '}
                    </p>
                </div>
            </div>
            <div className="row">
                <div className="column large-4 shrink">
                    <SvgImage name="golos" width="64px" height="64px" />
                </div>
                <div className="column large-8">
                    <a href={authRegisterUrl()} className="button secondary">Продолжить с электронной почтой</a>
                </div>
            </div>
            <div className="row">
                <div className="column">
                      <br />
                    <p className="secondary">
                        {tt('enter_confirm_email_jsx.next_3_strings.by_verifying_you_agree_with') + ' '}
                        {' ' + tt('enter_confirm_email_jsx.next_3_strings.by_verifying_you_agree_with_privacy_policy_of_website_APP_DOMAIN', {APP_DOMAIN})}.
                    </p>
                </div>
            </div>
        </div>
    }
}

export default connect(
    state => {
        return {
            serverBusy: state.offchain.get('serverBusy')
        };
    }
)(SignUp);
