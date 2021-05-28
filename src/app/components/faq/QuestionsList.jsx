import React, { PureComponent } from 'react';
import styled from 'styled-components';
import PropTypes from 'prop-types';
import Question from './Question';
import Container from '../Container/Container';

const Wrapper = styled(Container).attrs(props => ({
    column: 1,
}))`
    padding: 60px 64px 40px;

    @media (max-width: 1200px) {
        padding: 40px 16px;
    }
`;

export default class QuestionsList extends PureComponent {
    static propTypes = {
        questions: PropTypes.arrayOf(PropTypes.object),
    };

    static defaultProps = {
        questions: [],
    };

    render() {
        const { questions } = this.props;
        return (
            <Wrapper>
                {questions.map((question, index) => (
                    <Question key={index} question={question} />
                ))}
            </Wrapper>
        );
    }
}
